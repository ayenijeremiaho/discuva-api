import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  COMMUNITY_REF_ID,
  TeamSpaceKindEnum,
} from '../entity/team-space.entity';
import { TeamPost } from '../entity/team-post.entity';
import { TeamPostReply } from '../entity/team-post-reply.entity';
import { PostReport, ReportOutcomeEnum } from '../entity/post-report.entity';
import { CommunityCategory } from '../entity/community-category.entity';
import { Member } from '../../member/entity/member.entity';
import { TeamSpaceAccessService } from './team-space-access.service';
import { TeamSpaceService, excerpt } from './team-space.service';
import {
  MUTE_DAYS,
  REPORT_PUSH_THROTTLE_SECONDS,
  REPORTS_PAGE_SIZE,
} from '../constant/team-space.constant';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';
import { UtilityService } from '../../utility/service/utility.service';

const NAME_SQL = (alias: string) =>
  `NULLIF(TRIM(COALESCE(${alias}.firstname, '') || ' ' || COALESCE(${alias}.lastname, '')), '')`;
const DAY_MS = 24 * 3600 * 1000;
const REPORT_PUSH_KEY = 'community-report-push';
const REMOVED_AFTER_REPORT = 'Removed after a report.';

interface ReportRow {
  id: string;
  reason: string;
  created_at: Date;
  reporter_id: string | null;
  reporter_name: string | null;
  post_id: string;
  post_title: string | null;
  post_body: string;
  post_author_id: string | null;
  post_author_name: string | null;
  reply_id: string | null;
  reply_body: string | null;
  reply_author_id: string | null;
  reply_author_name: string | null;
}

const person = (id: string | null, name: string | null) =>
  id ? { id, name: name ?? 'Member' } : null;

// Reports, mutes, moderators and categories for the Community space. Posting itself stays in TeamSpaceService.
@Injectable()
export class CommunityService {
  constructor(
    @InjectRepository(PostReport)
    private readonly reportRepo: Repository<PostReport>,
    @InjectRepository(CommunityCategory)
    private readonly categoryRepo: Repository<CommunityCategory>,
    @InjectRepository(TeamPost)
    private readonly postRepo: Repository<TeamPost>,
    @InjectRepository(TeamPostReply)
    private readonly replyRepo: Repository<TeamPostReply>,
    private readonly access: TeamSpaceAccessService,
    private readonly spaces: TeamSpaceService,
    private readonly notifications: NotificationDispatchService,
    private readonly cacheService: CacheService,
    private readonly audit: AuditLogService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async report(
    memberId: string,
    target: { postId?: string; replyId?: string },
    reason: string,
  ) {
    const item = await this.reportable(target);
    await this.access.access(
      memberId,
      TeamSpaceKindEnum.COMMUNITY,
      COMMUNITY_REF_ID,
    );
    if (item.authorId === memberId)
      throw new BadRequestException("You can't report your own post.");
    await this.reportRepo
      .createQueryBuilder()
      .insert()
      .into(PostReport)
      .values({
        post: { id: item.postId } as TeamPost,
        reply: item.replyId ? ({ id: item.replyId } as TeamPostReply) : null,
        reporter: { id: memberId } as Member,
        reason,
      })
      .orIgnore()
      .execute();
    await this.tellModerators(reason);
    return { ok: true };
  }

  async reports(memberId: string, page = 1) {
    await this.assertModerator(memberId);
    const offset = (Math.max(page, 1) - 1) * REPORTS_PAGE_SIZE;
    const [rows, total] = await Promise.all([
      this.reportRepo.query(
        `SELECT r.id, r.reason, r.created_at,
           rp.id AS reporter_id, ${NAME_SQL('rp')} AS reporter_name,
           p.id AS post_id, p.title AS post_title, p.body AS post_body,
           pa.id AS post_author_id, ${NAME_SQL('pa')} AS post_author_name,
           y.id AS reply_id, y.body AS reply_body,
           ya.id AS reply_author_id, ${NAME_SQL('ya')} AS reply_author_name
         FROM post_reports r
         JOIN team_posts p ON p.id = r.post_id
         LEFT JOIN team_post_replies y ON y.id = r.reply_id
         LEFT JOIN members rp ON rp.id = r.reporter_id
         LEFT JOIN members pa ON pa.id = p.author_id
         LEFT JOIN members ya ON ya.id = y.author_id
         WHERE r.resolved_at IS NULL
         ORDER BY r.created_at DESC
         LIMIT $1 OFFSET $2`,
        [REPORTS_PAGE_SIZE, offset],
      ) as Promise<ReportRow[]>,
      this.reportRepo.query(
        `SELECT count(*)::int AS n FROM post_reports WHERE resolved_at IS NULL`,
      ) as Promise<{ n: number }[]>,
    ]);
    return UtilityService.createPaginationResponse(
      rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        createdAt: r.created_at,
        reporter: person(r.reporter_id, r.reporter_name),
        post: {
          id: r.post_id,
          title: r.post_title,
          excerpt: excerpt(r.post_body),
          author: person(r.post_author_id, r.post_author_name),
        },
        reply: r.reply_id
          ? {
              id: r.reply_id,
              excerpt: excerpt(r.reply_body ?? ''),
              author: person(r.reply_author_id, r.reply_author_name),
            }
          : null,
      })),
      Math.max(page, 1),
      REPORTS_PAGE_SIZE,
      total[0]?.n ?? 0,
    );
  }

  // Every open report on the same post or reply is settled together.
  async resolve(
    memberId: string,
    reportId: string,
    outcome: ReportOutcomeEnum,
    now = new Date(),
  ) {
    await this.assertModerator(memberId);
    const report = await this.reportRepo.findOne({
      where: { id: reportId },
      relations: { post: true, reply: true },
    });
    if (!report || report.resolvedAt)
      throw new NotFoundException('This report is already settled.');
    if (outcome === ReportOutcomeEnum.REMOVED) {
      if (report.reply)
        await this.removeIfThere(() =>
          this.spaces.removeReply(
            memberId,
            report.reply!.id,
            REMOVED_AFTER_REPORT,
          ),
        );
      else
        await this.removeIfThere(() =>
          this.spaces.removePost(
            memberId,
            report.post.id,
            REMOVED_AFTER_REPORT,
          ),
        );
    }
    const qb = this.reportRepo
      .createQueryBuilder()
      .update(PostReport)
      .set({
        resolvedAt: now,
        resolvedBy: { id: memberId } as Member,
        outcome,
      })
      .where('resolved_at IS NULL AND post_id = :postId', {
        postId: report.post.id,
      });
    if (report.reply)
      qb.andWhere('reply_id = :replyId', { replyId: report.reply.id });
    else qb.andWhere('reply_id IS NULL');
    await qb.execute();
    this.audit.log('COMMUNITY_REPORT_RESOLVED', {
      actorId: memberId,
      metadata: { reportId, outcome },
    });
    return { outcome };
  }

  async mute(
    memberId: string,
    targetId: string,
    days: number,
    reason?: string,
    now = new Date(),
  ) {
    await this.assertModerator(memberId);
    if (!MUTE_DAYS.includes(days))
      throw new BadRequestException(`Choose ${MUTE_DAYS.join(', ')} days.`);
    if (targetId === memberId)
      throw new BadRequestException("You can't mute yourself.");
    if (await this.access.isModerator(targetId))
      throw new ForbiddenException("Moderators can't mute each other.");
    const until = new Date(now.getTime() + days * DAY_MS);
    await this.reportRepo.query(
      `INSERT INTO community_mutes (member_id, until, reason, muted_by_id)
       SELECT id, $2, $3, $4 FROM members WHERE id = $1 AND status = 'ACTIVE'
       ON CONFLICT (member_id) DO UPDATE
         SET until = EXCLUDED.until, reason = EXCLUDED.reason, muted_by_id = EXCLUDED.muted_by_id, updated_at = now()`,
      [targetId, until, reason ?? null, memberId],
    );
    this.audit.log('COMMUNITY_MEMBER_MUTED', {
      actorId: memberId,
      targetId,
      metadata: { days, reason },
    });
    return { until };
  }

  async unmute(memberId: string, targetId: string) {
    await this.assertModerator(memberId);
    await this.reportRepo.query(
      `DELETE FROM community_mutes WHERE member_id = $1`,
      [targetId],
    );
    this.audit.log('COMMUNITY_MEMBER_UNMUTED', { actorId: memberId, targetId });
    return { ok: true };
  }

  // Named moderators and admins whose role carries the permission; only named ones can be removed here.
  async moderators() {
    const rows = (await this.reportRepo.query(
      `SELECT m.id, ${NAME_SQL('m')} AS name, m.photo_url, bool_or(src = 'NAMED') AS named, bool_or(src = 'ADMIN') AS admin
       FROM (
         SELECT member_id, 'NAMED' AS src FROM community_moderators
         UNION ALL
         SELECT a.member_id, 'ADMIN' FROM admins a JOIN admin_roles r ON r.id = a.admin_role_id
         WHERE a.is_active AND 'community:moderate' = ANY(r.permissions)
       ) x
       JOIN members m ON m.id = x.member_id
       GROUP BY m.id
       ORDER BY name`,
    )) as {
      id: string;
      name: string | null;
      photo_url: string | null;
      named: boolean;
      admin: boolean;
    }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name ?? 'Member',
      photoUrl: r.photo_url,
      named: r.named,
      viaPermission: r.admin,
    }));
  }

  async addModerator(actorId: string, memberId: string) {
    const rows = (await this.reportRepo.query(
      `SELECT status FROM members WHERE id = $1`,
      [memberId],
    )) as { status: string }[];
    if (rows[0]?.status !== 'ACTIVE')
      throw new BadRequestException('Only active members can be moderators.');
    if (await this.access.isMinor(memberId))
      throw new BadRequestException('Moderators must be 18 or older.');
    await this.reportRepo.query(
      `INSERT INTO community_moderators (member_id, added_by_id) VALUES ($1, $2) ON CONFLICT (member_id) DO NOTHING`,
      [memberId, actorId],
    );
    await this.reportRepo.query(
      `DELETE FROM community_mutes WHERE member_id = $1`,
      [memberId],
    );
    this.audit.log('COMMUNITY_MODERATOR_ADDED', {
      actorId,
      targetId: memberId,
    });
    return this.moderators();
  }

  async removeModerator(actorId: string, memberId: string) {
    await this.reportRepo.query(
      `DELETE FROM community_moderators WHERE member_id = $1`,
      [memberId],
    );
    this.audit.log('COMMUNITY_MODERATOR_REMOVED', {
      actorId,
      targetId: memberId,
    });
    return this.moderators();
  }

  categories() {
    return this.categoryRepo.find({ order: { position: 'ASC', name: 'ASC' } });
  }

  async addCategory(actorId: string, name: string) {
    const max = await this.settings.getNumber(
      PlatformSettingKey.COMMUNITY_MAX_CATEGORIES,
    );
    if ((await this.categoryRepo.count()) >= max)
      throw new BadRequestException(`Up to ${max} categories.`);
    const last = await this.categoryRepo.findOne({
      where: {},
      order: { position: 'DESC' },
    });
    await this.saveCategory(
      this.categoryRepo.create({ name, position: (last?.position ?? -1) + 1 }),
    );
    this.audit.log('COMMUNITY_CATEGORIES_CHANGED', {
      actorId,
      metadata: { added: name },
    });
    return this.categories();
  }

  async renameCategory(actorId: string, id: string, name: string) {
    const category = await this.categoryRepo.findOneBy({ id });
    if (!category) throw new NotFoundException('Category not found');
    category.name = name;
    await this.saveCategory(category);
    this.audit.log('COMMUNITY_CATEGORIES_CHANGED', {
      actorId,
      metadata: { renamed: id, name },
    });
    return this.categories();
  }

  // The new order is the list of ids; positions follow it.
  async reorderCategories(actorId: string, ids: string[]) {
    const existing = await this.categoryRepo.find({ select: { id: true } });
    const known = new Set(existing.map((c) => c.id));
    if (ids.length !== known.size || ids.some((id) => !known.has(id)))
      throw new BadRequestException('Send every category once, in order.');
    await this.categoryRepo.query(
      `UPDATE community_categories c SET position = o.position - 1
       FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, position) WHERE c.id = o.id`,
      [ids],
    );
    this.audit.log('COMMUNITY_CATEGORIES_CHANGED', {
      actorId,
      metadata: { reordered: true },
    });
    return this.categories();
  }

  // Posts in a removed category simply have none.
  async removeCategory(actorId: string, id: string) {
    const { affected } = await this.categoryRepo.delete({ id });
    if (!affected) throw new NotFoundException('Category not found');
    this.audit.log('COMMUNITY_CATEGORIES_CHANGED', {
      actorId,
      metadata: { removed: id },
    });
    return this.categories();
  }

  private async saveCategory(category: CommunityCategory) {
    try {
      await this.categoryRepo.save(category);
    } catch (err) {
      if ((err as { code?: string }).code === '23505')
        throw new ConflictException(
          'There is already a category with that name.',
        );
      throw err;
    }
  }

  private async assertModerator(memberId: string) {
    if (!(await this.access.isModerator(memberId)))
      throw new ForbiddenException('Only Community moderators can do this.');
  }

  private async reportable(target: { postId?: string; replyId?: string }) {
    if (target.replyId) {
      const reply = await this.replyRepo.findOne({
        where: { id: target.replyId },
        relations: { author: true, post: { space: true } },
      });
      if (!reply || reply.removedAt || reply.post.removedAt)
        throw new NotFoundException('Reply not found');
      this.assertCommunity(reply.post.space.kind);
      return {
        postId: reply.post.id,
        replyId: reply.id,
        authorId: reply.author?.id ?? null,
      };
    }
    const post = await this.postRepo.findOne({
      where: { id: target.postId },
      relations: { author: true, space: true },
    });
    if (!post || post.removedAt) throw new NotFoundException('Post not found');
    this.assertCommunity(post.space.kind);
    return {
      postId: post.id,
      replyId: null,
      authorId: post.author?.id ?? null,
    };
  }

  private assertCommunity(kind: TeamSpaceKindEnum) {
    if (kind !== TeamSpaceKindEnum.COMMUNITY)
      throw new BadRequestException('Only Community posts can be reported.');
  }

  private async tellModerators(reason: string) {
    if (await this.cacheService.get(REPORT_PUSH_KEY)) return;
    this.cacheService.set(REPORT_PUSH_KEY, true, REPORT_PUSH_THROTTLE_SECONDS);
    const memberIds = (await this.moderators()).map((m) => m.id);
    if (!memberIds.length) return;
    this.notifications
      .notifyMember({
        category: EmailCategory.COMMUNITY,
        push: {
          memberIds,
          key: PushNotificationKey.COMMUNITY_REPORT,
          vars: { space_name: 'Community', excerpt: `Reported for: ${reason}` },
          url: '/team-spaces',
          idempotencyKey: `community-report:${Date.now()}`,
        },
      })
      .catch(() => undefined);
  }

  private async removeIfThere(remove: () => Promise<unknown>) {
    try {
      await remove();
    } catch (err) {
      if (!(err instanceof NotFoundException)) throw err;
    }
  }
}
