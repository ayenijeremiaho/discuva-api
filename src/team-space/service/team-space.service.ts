import {
  POST_MAX_LENGTH,
  REPLY_MAX_LENGTH,
} from '../constant/team-space.constant';
import {
  MAX_TAGGED_PEOPLE,
  parseMentions,
  plainText,
  rewriteMentions,
} from '../util/mentions';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { TeamSpace, TeamSpaceKindEnum } from '../entity/team-space.entity';
import { TeamPost } from '../entity/team-post.entity';
import { TeamPostReply } from '../entity/team-post-reply.entity';
import { CommunityCategory } from '../entity/community-category.entity';
import { TeamSpaceRead } from '../entity/team-space-read.entity';
import { Member } from '../../member/entity/member.entity';
import {
  SpaceAccess,
  TeamSpaceAccessService,
} from './team-space-access.service';
import {
  MeetingView,
  PollView,
  TeamSpaceExtrasService,
} from './team-space-extras.service';
import {
  ReactionSummary,
  TeamSpaceReactionService,
} from './team-space-reaction.service';
import {
  FEED_PAGE_SIZE,
  MAX_PINNED,
  REPLY_PAGE_SIZE,
  REPLY_PUSH_THROTTLE_SECONDS,
  UNREAD_CAP,
} from '../constant/team-space.constant';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { CacheService } from '../../utility/service/cache.service';

export interface Author {
  id: string;
  name: string;
  photoUrl: string | null;
}

interface PostRow {
  id: string;
  type: string;
  body: string;
  title: string | null;
  category_id: string | null;
  category_name: string | null;
  locked_at: Date | null;
  pinned: boolean;
  reply_count: number;
  last_activity_at: Date;
  created_at: Date;
  edited_at: Date | null;
  author_id: string | null;
  author_name: string | null;
  author_photo: string | null;
}

interface ReplyRow {
  id: string;
  body: string;
  created_at: Date;
  edited_at: Date | null;
  author_id: string | null;
  author_name: string | null;
  author_photo: string | null;
}

// "iso|id": where the next page starts, so paging is an index seek however far back it goes.
export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${new Date(at).toISOString()}|${id}`).toString(
    'base64url',
  );
}

export function decodeCursor(cursor?: string): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const at = new Date(iso);
  if (!id || Number.isNaN(at.getTime()))
    throw new BadRequestException('Invalid page');
  return { at, id };
}

export function excerpt(text: string, max = 120): string {
  const flat = plainText(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const NAME_SQL = `NULLIF(TRIM(COALESCE(firstname, '') || ' ' || COALESCE(lastname, '')), '')`;
const PEOPLE_SHOWN = 500;

interface TaggedBody {
  body: string;
  memberIds: string[];
  team: boolean;
}

const AUTHOR_SQL = `a.id AS author_id, NULLIF(TRIM(COALESCE(a.firstname, '') || ' ' || COALESCE(a.lastname, '')), '') AS author_name, a.photo_url AS author_photo`;
const POST_SQL = `p.id, p.type, p.body, p.title, p.category_id, c.name AS category_name, p.locked_at, p.pinned, p.reply_count, p.last_activity_at, p.created_at, p.edited_at, ${AUTHOR_SQL}`;
const POST_FROM = `team_posts p LEFT JOIN members a ON a.id = p.author_id LEFT JOIN community_categories c ON c.id = p.category_id`;

export interface PostExtras {
  title?: string;
  categoryId?: string | null;
}

const isCommunity = (acc: Pick<SpaceAccess, 'kind'>) =>
  acc.kind === TeamSpaceKindEnum.COMMUNITY;

// Community is its own notification type, so members can mute it apart from their teams.
const PUSH_KEYS = {
  team: {
    category: EmailCategory.TEAM_SPACES,
    leaderPost: PushNotificationKey.TEAM_SPACE_LEADER_POST,
    reply: PushNotificationKey.TEAM_SPACE_REPLY,
    mention: PushNotificationKey.TEAM_SPACE_MENTION,
  },
  community: {
    category: EmailCategory.COMMUNITY,
    leaderPost: PushNotificationKey.COMMUNITY_MODERATOR_POST,
    reply: PushNotificationKey.COMMUNITY_REPLY,
    mention: PushNotificationKey.COMMUNITY_MENTION,
  },
};
const pushKeys = (acc: Pick<SpaceAccess, 'kind'>) =>
  isCommunity(acc) ? PUSH_KEYS.community : PUSH_KEYS.team;

const mutedMessage = (until: Date) =>
  `A moderator has paused your posting in Community until ${new Date(until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}. You can still read and react.`;

@Injectable()
export class TeamSpaceService {
  constructor(
    @InjectRepository(TeamSpace)
    private readonly spaceRepo: Repository<TeamSpace>,
    @InjectRepository(TeamPost)
    private readonly postRepo: Repository<TeamPost>,
    @InjectRepository(TeamPostReply)
    private readonly replyRepo: Repository<TeamPostReply>,
    @InjectRepository(TeamSpaceRead)
    private readonly readRepo: Repository<TeamSpaceRead>,
    private readonly access: TeamSpaceAccessService,
    private readonly notifications: NotificationDispatchService,
    private readonly audit: AuditLogService,
    private readonly cacheService: CacheService,
    private readonly extras: TeamSpaceExtrasService,
    private readonly reactions: TeamSpaceReactionService,
  ) {}

  // The member's spaces, busiest first, each with how many conversations have news since they last looked.
  async list(memberId: string) {
    const memberships = await this.access.memberships(memberId);
    if (!memberships.length) return [];
    const rows = (await this.spaceRepo.query(
      `SELECT s.kind, s.ref_id, s.leaders_only, s.last_activity_at,
         (SELECT count(*) FROM (
            SELECT 1 FROM team_posts p
            WHERE p.space_id = s.id AND p.removed_at IS NULL
              AND p.last_activity_at > COALESCE(r.last_read_at, '-infinity')
            LIMIT $4) x)::int AS unread
       FROM team_spaces s
       LEFT JOIN team_space_reads r ON r.space_id = s.id AND r.member_id = $1
       WHERE (s.kind, s.ref_id) IN (SELECT * FROM unnest($2::varchar[], $3::uuid[]))`,
      [
        memberId,
        memberships.map((m) => m.kind),
        memberships.map((m) => m.refId),
        UNREAD_CAP,
      ],
    )) as {
      kind: string;
      ref_id: string;
      leaders_only: boolean;
      last_activity_at: Date | null;
      unread: number;
    }[];
    const byRef = new Map(rows.map((r) => [`${r.kind}:${r.ref_id}`, r]));
    return memberships
      .map((m) => {
        const r = byRef.get(`${m.kind}:${m.refId}`);
        return {
          ...m,
          leadersOnly: r?.leaders_only ?? false,
          lastActivityAt: r?.last_activity_at ?? null,
          unread: r?.unread ?? 0,
        };
      })
      .sort(
        (a, b) =>
          Number(b.kind === TeamSpaceKindEnum.COMMUNITY) -
            Number(a.kind === TeamSpaceKindEnum.COMMUNITY) ||
          (b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0) -
            (a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0) ||
          a.name.localeCompare(b.name),
      );
  }

  // Opening a space: who can do what, its pinned posts, and it counts as read from now.
  async open(memberId: string, kind: TeamSpaceKindEnum, refId: string) {
    const [acc, minor] = await Promise.all([
      this.access.access(memberId, kind, refId),
      this.access.isMinor(memberId),
    ]);
    const community = isCommunity(acc)
      ? await this.communityState(memberId, acc.isLeader)
      : null;
    const [pinned, upcomingMeetings] = await Promise.all([
      this.postRows(acc.space.id, { pinned: true }),
      this.extras.upcoming(acc.space.id),
      this.markRead(memberId, acc.space.id),
    ]);
    const [details, reactions] = await Promise.all([
      this.extras.details(pinned, memberId),
      this.reactions.summaries(
        memberId,
        pinned.map((p) => p.id),
      ),
    ]);
    return {
      kind,
      refId,
      name: acc.name,
      isLeader: acc.isLeader,
      leadersOnly: acc.space.leadersOnly,
      isUnder18: minor,
      eventAt: acc.eventAt ?? null,
      closed: !!acc.closed,
      canPost:
        !acc.closed &&
        !minor &&
        !community?.mutedUntil &&
        (!acc.space.leadersOnly || acc.isLeader),
      pinned: pinned.map((p) =>
        this.toPost(p, memberId, acc, details, reactions),
      ),
      upcomingMeetings,
      community,
    };
  }

  // What a Community screen needs on top of a team space: categories, the member's mute, and open reports for moderators.
  private async communityState(memberId: string, moderator: boolean) {
    const [categories, mutedUntil, openReports] = await Promise.all([
      this.spaceRepo.query(
        `SELECT id, name FROM community_categories ORDER BY position, name`,
      ) as Promise<{ id: string; name: string }[]>,
      this.access.mutedUntil(memberId),
      moderator
        ? (this.spaceRepo.query(
            `SELECT count(*)::int AS n FROM (SELECT 1 FROM post_reports WHERE resolved_at IS NULL LIMIT $1) x`,
            [UNREAD_CAP],
          ) as Promise<{ n: number }[]>)
        : Promise.resolve(null),
    ]);
    return {
      categories,
      mutedUntil,
      openReports: openReports ? openReports[0].n : null,
    };
  }

  async feed(
    memberId: string,
    kind: TeamSpaceKindEnum,
    refId: string,
    cursor?: string,
    categoryId?: string,
  ) {
    const acc = await this.access.access(memberId, kind, refId);
    const rows = await this.postRows(acc.space.id, {
      pinned: false,
      after: decodeCursor(cursor),
      categoryId: isCommunity(acc) ? categoryId : undefined,
    });
    const page = rows.slice(0, FEED_PAGE_SIZE);
    const last = page[page.length - 1];
    const [details, reactions] = await Promise.all([
      this.extras.details(page, memberId),
      this.reactions.summaries(
        memberId,
        page.map((p) => p.id),
      ),
    ]);
    return {
      items: page.map((p) => this.toPost(p, memberId, acc, details, reactions)),
      nextCursor:
        rows.length > FEED_PAGE_SIZE && last
          ? encodeCursor(last.last_activity_at, last.id)
          : null,
    };
  }

  async createPost(
    memberId: string,
    kind: TeamSpaceKindEnum,
    refId: string,
    body: string,
    extras: PostExtras = {},
    now = new Date(),
  ) {
    const [acc, minor] = await Promise.all([
      this.access.access(memberId, kind, refId),
      this.access.isMinor(memberId),
    ]);
    this.access.assertOpen(acc);
    await this.assertNotMuted(acc, memberId);
    if (minor)
      throw new ForbiddenException(
        'Members under 18 can read and reply to posts, but not start them.',
      );
    if (acc.space.leadersOnly && !acc.isLeader)
      throw new ForbiddenException(
        'Only leaders can start posts in this space. You can reply to any post.',
      );
    const tagged = await this.prepareTags(acc, body, POST_MAX_LENGTH);
    const community = isCommunity(acc);
    if (community && extras.categoryId)
      await this.assertCategory(extras.categoryId);
    const post = await this.postRepo.save(
      this.postRepo.create({
        space: { id: acc.space.id } as TeamSpace,
        author: { id: memberId } as Member,
        body: tagged.body,
        title: (community && extras.title) || null,
        category:
          community && extras.categoryId
            ? ({ id: extras.categoryId } as CommunityCategory)
            : null,
        lastActivityAt: now,
      }),
    );
    await Promise.all([
      this.spaceRepo.update(acc.space.id, { lastActivityAt: now }),
      this.markRead(memberId, acc.space.id, now),
    ]);
    // Leaders' posts go out straight away; everyone else's wait for the evening summary.
    const notified = await this.notifyTagged(acc, tagged, memberId, {
      url: `/team-spaces/post/${post.id}`,
      dedupe: `team-post-tag:${post.id}`,
    });
    if (acc.isLeader) await this.pushLeaderPost(acc, post, memberId, notified);
    return { id: post.id };
  }

  async editPost(
    memberId: string,
    postId: string,
    body: string,
    extras: PostExtras = {},
    now = new Date(),
  ) {
    const post = await this.findPost(postId);
    if (post.author?.id !== memberId)
      throw new ForbiddenException('You can only edit your own posts.');
    const acc = await this.editAccess(memberId, post.space, body);
    const tagged = await this.prepareTags(acc, body, POST_MAX_LENGTH);
    const community = post.space.kind === TeamSpaceKindEnum.COMMUNITY;
    if (community && extras.categoryId)
      await this.assertCategory(extras.categoryId);
    await this.postRepo.update(postId, {
      body: tagged.body,
      editedAt: now,
      ...(community && extras.title !== undefined
        ? { title: extras.title || null }
        : {}),
      ...(community && extras.categoryId !== undefined
        ? {
            category: extras.categoryId
              ? ({ id: extras.categoryId } as CommunityCategory)
              : null,
          }
        : {}),
    });
    await this.notifyNewTags(acc, tagged, post.body, memberId, {
      url: `/team-spaces/post/${postId}`,
      dedupe: `team-post-tag:${postId}:${now.getTime()}`,
    });
    return { ok: true };
  }

  async removePost(
    memberId: string,
    postId: string,
    reason?: string,
    now = new Date(),
  ) {
    const post = await this.findPost(postId);
    const acc = await this.access.accessBySpace(memberId, post.space);
    const own = post.author?.id === memberId;
    if (!own && !acc.isLeader)
      throw new ForbiddenException(
        'Only the author or a leader can remove this.',
      );
    await this.postRepo.update(postId, {
      removedAt: now,
      removedBy: { id: memberId } as Member,
      pinned: false,
    });
    if (!own) {
      this.audit.log('TEAM_POST_REMOVED', {
        actorId: memberId,
        targetId: post.author?.id,
        metadata: { postId, space: acc.name, kind: acc.kind, reason },
      });
      this.tellRemoved(acc, post.author?.id, postId, reason);
    }
    return { ok: true };
  }

  // Community only: a moderator stops a conversation without removing it.
  async lock(
    memberId: string,
    postId: string,
    locked: boolean,
    now = new Date(),
  ) {
    const post = await this.findPost(postId);
    const acc = await this.access.accessBySpace(memberId, post.space);
    if (!isCommunity(acc) || !acc.isLeader)
      throw new ForbiddenException('Only Community moderators can lock posts.');
    await this.postRepo.update(postId, {
      lockedAt: locked ? now : null,
      lockedBy: locked ? ({ id: memberId } as Member) : null,
    });
    return { locked };
  }

  // The author or a moderator can move a Community post to another category.
  async setCategory(
    memberId: string,
    postId: string,
    categoryId: string | null,
  ) {
    const post = await this.findPost(postId);
    const acc = await this.access.accessBySpace(memberId, post.space);
    if (!isCommunity(acc))
      throw new BadRequestException('Only Community posts have categories.');
    if (post.author?.id !== memberId && !acc.isLeader)
      throw new ForbiddenException(
        'Only the author or a moderator can change this.',
      );
    if (categoryId) await this.assertCategory(categoryId);
    await this.postRepo.update(postId, {
      category: categoryId ? ({ id: categoryId } as CommunityCategory) : null,
    });
    return { categoryId };
  }

  async pin(memberId: string, postId: string, pinned: boolean) {
    const post = await this.findPost(postId);
    const acc = await this.access.accessBySpace(memberId, post.space);
    if (!acc.isLeader)
      throw new ForbiddenException('Only leaders can pin posts.');
    if (pinned && !post.pinned) {
      const count = await this.postRepo.count({
        where: {
          space: { id: acc.space.id },
          pinned: true,
          removedAt: IsNull(),
        },
      });
      if (count >= MAX_PINNED)
        throw new BadRequestException(
          `Up to ${MAX_PINNED} posts can be pinned. Unpin one first.`,
        );
    }
    await this.postRepo.update(postId, { pinned });
    return { ok: true };
  }

  async thread(memberId: string, postId: string, cursor?: string) {
    const post = await this.findPost(postId);
    const acc = await this.access.accessBySpace(memberId, post.space);
    const after = decodeCursor(cursor);
    const [postRow, replies] = await Promise.all([
      this.spaceRepo.query(
        `SELECT ${POST_SQL} FROM ${POST_FROM} WHERE p.id = $1`,
        [postId],
      ) as Promise<PostRow[]>,
      this.spaceRepo.query(
        `SELECT r.id, r.body, r.created_at, r.edited_at, ${AUTHOR_SQL}
         FROM team_post_replies r LEFT JOIN members a ON a.id = r.author_id
         WHERE r.post_id = $1 AND r.removed_at IS NULL
           ${after ? 'AND (r.created_at, r.id) > ($3, $4)' : ''}
         ORDER BY r.created_at, r.id
         LIMIT $2`,
        after
          ? [postId, REPLY_PAGE_SIZE + 1, after.at, after.id]
          : [postId, REPLY_PAGE_SIZE + 1],
      ) as Promise<ReplyRow[]>,
    ]);
    const page = replies.slice(0, REPLY_PAGE_SIZE);
    const last = page[page.length - 1];
    const [minor, mutedUntil, details, reactions] = await Promise.all([
      this.access.isMinor(memberId),
      isCommunity(acc)
        ? this.access.mutedUntil(memberId)
        : Promise.resolve(null),
      this.extras.details(postRow, memberId),
      this.reactions.summaries(
        memberId,
        [postId],
        page.map((r) => r.id),
      ),
    ]);
    return {
      space: { kind: acc.kind, refId: acc.refId, name: acc.name },
      post: this.toPost(postRow[0], memberId, acc, details, reactions),
      canReply: !acc.closed && !post.lockedAt && !mutedUntil,
      locked: !!post.lockedAt,
      mutedUntil,
      isUnder18: minor,
      replies: page.map((r) => ({
        id: r.id,
        body: r.body,
        createdAt: r.created_at,
        editedAt: r.edited_at,
        author: this.author(r),
        mine: r.author_id === memberId,
        canRemove: r.author_id === memberId || acc.isLeader,
        canReport: isCommunity(acc) && r.author_id !== memberId,
        reactions: reactions.get(r.id) ?? [],
      })),
      nextCursor:
        replies.length > REPLY_PAGE_SIZE && last
          ? encodeCursor(last.created_at, last.id)
          : null,
    };
  }

  async reply(
    memberId: string,
    postId: string,
    body: string,
    now = new Date(),
  ) {
    const post = await this.findPost(postId);
    const acc = await this.access.accessBySpace(memberId, post.space);
    this.access.assertOpen(acc);
    if (post.lockedAt)
      throw new ForbiddenException(
        'This conversation is locked. You can still read it.',
      );
    await this.assertNotMuted(acc, memberId);
    const tagged = await this.prepareTags(acc, body, REPLY_MAX_LENGTH);
    const reply = await this.replyRepo.save(
      this.replyRepo.create({
        post: { id: postId } as TeamPost,
        author: { id: memberId } as Member,
        body: tagged.body,
      }),
    );
    await Promise.all([
      this.postRepo
        .createQueryBuilder()
        .update(TeamPost)
        .set({ replyCount: () => 'reply_count + 1', lastActivityAt: now })
        .where('id = :postId', { postId })
        .execute(),
      this.spaceRepo.update(acc.space.id, { lastActivityAt: now }),
      this.markRead(memberId, acc.space.id, now),
    ]);
    const notified = await this.notifyTagged(acc, tagged, memberId, {
      url: `/team-spaces/post/${postId}`,
      dedupe: `team-reply-tag:${reply.id}`,
    });
    const authorId = post.author?.id;
    if (authorId && authorId !== memberId && !notified.has(authorId))
      await this.pushReply(acc, post, reply, memberId, authorId);
    return { id: reply.id };
  }

  async editReply(
    memberId: string,
    replyId: string,
    body: string,
    now = new Date(),
  ) {
    const reply = await this.replyRepo.findOne({
      where: { id: replyId },
      relations: { author: true, post: { space: true } },
    });
    if (!reply || reply.removedAt)
      throw new NotFoundException('Reply not found');
    if (reply.author?.id !== memberId)
      throw new ForbiddenException('You can only edit your own replies.');
    const acc = await this.editAccess(memberId, reply.post.space, body);
    const tagged = await this.prepareTags(acc, body, REPLY_MAX_LENGTH);
    await this.replyRepo.update(replyId, { body: tagged.body, editedAt: now });
    await this.notifyNewTags(acc, tagged, reply.body, memberId, {
      url: `/team-spaces/post/${reply.post.id}`,
      dedupe: `team-reply-tag:${replyId}:${now.getTime()}`,
    });
    return { ok: true };
  }

  async removeReply(
    memberId: string,
    replyId: string,
    reason?: string,
    now = new Date(),
  ) {
    const reply = await this.replyRepo.findOne({
      where: { id: replyId },
      relations: { author: true, post: { space: true } },
    });
    if (!reply || reply.removedAt)
      throw new NotFoundException('Reply not found');
    const acc = await this.access.accessBySpace(memberId, reply.post.space);
    const own = reply.author?.id === memberId;
    if (!own && !acc.isLeader)
      throw new ForbiddenException(
        'Only the author or a leader can remove this.',
      );
    await this.replyRepo.update(replyId, {
      removedAt: now,
      removedBy: { id: memberId } as Member,
    });
    await this.postRepo
      .createQueryBuilder()
      .update(TeamPost)
      .set({ replyCount: () => 'GREATEST(reply_count - 1, 0)' })
      .where('id = :id', { id: reply.post.id })
      .execute();
    if (!own) {
      this.audit.log('TEAM_POST_REMOVED', {
        actorId: memberId,
        targetId: reply.author?.id,
        metadata: {
          replyId,
          postId: reply.post.id,
          space: acc.name,
          kind: acc.kind,
          reason,
        },
      });
      this.tellRemoved(acc, reply.author?.id, replyId, reason);
    }
    return { ok: true };
  }

  async updateSettings(
    memberId: string,
    kind: TeamSpaceKindEnum,
    refId: string,
    leadersOnly: boolean,
  ) {
    const acc = await this.access.access(memberId, kind, refId);
    if (!acc.isLeader)
      throw new ForbiddenException("Only the team's leaders can change this.");
    await this.spaceRepo.update(acc.space.id, { leadersOnly });
    this.audit.log('TEAM_SPACE_SETTINGS_UPDATED', {
      actorId: memberId,
      targetId: acc.refId,
      targetName: acc.name,
      metadata: { kind, leadersOnly },
    });
    return { leadersOnly };
  }

  private async findPost(postId: string): Promise<TeamPost> {
    const post = await this.postRepo.findOne({
      where: { id: postId },
      relations: { space: true, author: true },
    });
    if (!post || post.removedAt) throw new NotFoundException('Post not found');
    return post;
  }

  private postRows(
    spaceId: string,
    opts: {
      pinned: boolean;
      after?: { at: Date; id: string } | null;
      categoryId?: string;
    },
  ): Promise<PostRow[]> {
    const params: unknown[] = [
      spaceId,
      opts.pinned,
      opts.pinned ? MAX_PINNED : FEED_PAGE_SIZE + 1,
    ];
    const where: string[] = [];
    if (opts.categoryId) {
      params.push(opts.categoryId);
      where.push(`AND p.category_id = $${params.length}`);
    }
    if (opts.after) {
      params.push(opts.after.at, opts.after.id);
      where.push(
        `AND (p.last_activity_at, p.id) < ($${params.length - 1}, $${params.length})`,
      );
    }
    return this.spaceRepo.query(
      `SELECT ${POST_SQL} FROM ${POST_FROM}
       WHERE p.space_id = $1 AND p.removed_at IS NULL AND p.pinned = $2 ${where.join(' ')}
       ORDER BY p.last_activity_at DESC, p.id DESC
       LIMIT $3`,
      params,
    ) as Promise<PostRow[]>;
  }

  private async assertCategory(categoryId: string): Promise<void> {
    const rows = (await this.spaceRepo.query(
      `SELECT 1 FROM community_categories WHERE id = $1`,
      [categoryId],
    )) as unknown[];
    if (!rows.length) throw new BadRequestException('That category is gone.');
  }

  private async assertNotMuted(acc: SpaceAccess, memberId: string) {
    if (!isCommunity(acc)) return;
    const until = await this.access.mutedUntil(memberId);
    if (until) throw new ForbiddenException(mutedMessage(until));
  }

  private tellRemoved(
    acc: SpaceAccess,
    authorId: string | undefined,
    itemId: string,
    reason?: string,
  ) {
    if (!isCommunity(acc) || !authorId) return;
    this.notifications
      .notifyMember({
        category: EmailCategory.COMMUNITY,
        push: {
          memberIds: [authorId],
          key: PushNotificationKey.COMMUNITY_POST_REMOVED,
          vars: {
            space_name: acc.name,
            reason: reason || 'It broke the space guidelines.',
          },
          url: '/team-spaces',
          idempotencyKey: `community-removed:${itemId}`,
        },
      })
      .catch(() => undefined);
  }

  private toPost(
    p: PostRow,
    memberId: string,
    acc: SpaceAccess,
    details: {
      meetings: Map<string, MeetingView>;
      polls: Map<string, PollView>;
    },
    reactions: Map<string, ReactionSummary[]>,
  ) {
    return {
      id: p.id,
      type: p.type,
      meeting: details.meetings.get(p.id) ?? null,
      poll: details.polls.get(p.id) ?? null,
      body: p.body,
      title: p.title,
      category: p.category_id
        ? { id: p.category_id, name: p.category_name }
        : null,
      locked: !!p.locked_at,
      pinned: p.pinned,
      replyCount: Number(p.reply_count),
      createdAt: p.created_at,
      lastActivityAt: p.last_activity_at,
      editedAt: p.edited_at,
      author: this.author(p),
      mine: p.author_id === memberId,
      canRemove: p.author_id === memberId || acc.isLeader,
      canPin: acc.isLeader,
      canLock: isCommunity(acc) && acc.isLeader,
      canReport: isCommunity(acc) && p.author_id !== memberId,
      reactions: reactions.get(p.id) ?? [],
    };
  }

  private author(row: {
    author_id: string | null;
    author_name: string | null;
    author_photo: string | null;
  }): Author | null {
    return row.author_id
      ? {
          id: row.author_id,
          name: row.author_name ?? 'Member',
          photoUrl: row.author_photo,
        }
      : null;
  }

  private async markRead(memberId: string, spaceId: string, at = new Date()) {
    await this.readRepo
      .createQueryBuilder()
      .insert()
      .into(TeamSpaceRead)
      .values({
        member: { id: memberId } as Member,
        space: { id: spaceId } as TeamSpace,
        lastReadAt: at,
      })
      .orUpdate(['last_read_at', 'updated_at'], ['member_id', 'space_id'])
      .execute();
  }

  // Who can be tagged here. Read once when someone first types @, not on every keystroke.
  async people(memberId: string, kind: TeamSpaceKindEnum, refId: string) {
    const acc = await this.access.access(memberId, kind, refId);
    const ids = await this.access.memberIds(acc.space);
    const rows = (await this.spaceRepo.query(
      `SELECT id, ${NAME_SQL} AS name, photo_url FROM members
       WHERE id = ANY($1) AND id <> $2 ORDER BY firstname, lastname LIMIT ${PEOPLE_SHOWN}`,
      [ids, memberId],
    )) as { id: string; name: string | null; photo_url: string | null }[];
    return {
      people: rows
        .filter((r) => r.name)
        .map((r) => ({ id: r.id, name: r.name, photoUrl: r.photo_url })),
    };
  }

  // Text with no tags costs no queries. Editing only needs the space when tags are involved.
  private async editAccess(
    memberId: string,
    space: TeamSpace,
    body: string,
  ): Promise<SpaceAccess> {
    const { memberIds, team } = parseMentions(body);
    return memberIds.length || team
      ? this.access.accessBySpace(memberId, space)
      : ({ space, name: '', isLeader: false } as unknown as SpaceAccess);
  }

  private async prepareTags(
    acc: SpaceAccess,
    body: string,
    max: number,
  ): Promise<TaggedBody> {
    if (plainText(body).length > max)
      throw new BadRequestException(
        `Please keep this under ${max} characters.`,
      );
    const { memberIds, team } = parseMentions(body);
    if (memberIds.length > MAX_TAGGED_PEOPLE)
      throw new BadRequestException(
        `You can tag up to ${MAX_TAGGED_PEOPLE} people at a time.`,
      );
    if (team && isCommunity(acc) && !acc.isLeader)
      throw new BadRequestException('Only moderators can use @everyone.');
    if (!memberIds.length && !team) return { body, memberIds: [], team: false };
    const inSpace = new Set(await this.access.memberIds(acc.space));
    const allowed = memberIds.filter((id) => inSpace.has(id));
    const rows = (
      allowed.length
        ? await this.spaceRepo.query(
            `SELECT id, ${NAME_SQL} AS name FROM members WHERE id = ANY($1)`,
            [allowed],
          )
        : []
    ) as { id: string; name: string | null }[];
    const names = new Map(
      rows.filter((r) => r.name).map((r) => [r.id, r.name as string]),
    );
    return {
      body: rewriteMentions(
        body,
        names,
        isCommunity(acc) ? 'everyone' : undefined,
      ),
      memberIds: [...names.keys()],
      team,
    };
  }

  // Returns who was told, so nobody also gets the ordinary notification for the same message.
  private async notifyTagged(
    acc: SpaceAccess,
    tagged: TaggedBody,
    authorId: string,
    link: { url: string; dedupe: string },
  ): Promise<Set<string>> {
    if (!tagged.team && !tagged.memberIds.length) return new Set();
    const named = tagged.memberIds.filter((id) => id !== authorId);
    const everyone = tagged.team
      ? (await this.access.memberIds(acc.space)).filter((id) => id !== authorId)
      : [];
    const rows = (await this.spaceRepo.query(
      `SELECT id, email, ${NAME_SQL} AS name FROM members WHERE id = ANY($1)`,
      [[...named, authorId]],
    )) as { id: string; email: string; name: string | null }[];
    const authorName = rows.find((r) => r.id === authorId)?.name ?? 'Someone';
    const text = excerpt(tagged.body);
    const keys = pushKeys(acc);
    const push = {
      key: keys.mention,
      vars: {
        author_name: authorName,
        space_name: acc.name,
        excerpt: text,
      },
      url: link.url,
    };
    for (const row of rows) {
      if (row.id === authorId) continue;
      const heading = `${authorName} tagged you in ${acc.name}`;
      this.notifications
        .notifyMember({
          category: keys.category,
          email: {
            to: row.email,
            subject: heading,
            template: 'account-lifecycle-notice',
            data: { heading, message: text },
            recipientMemberId: row.id,
          },
          push: {
            ...push,
            memberIds: [row.id],
            idempotencyKey: `${link.dedupe}:${row.id}`,
          },
        })
        .catch(() => undefined);
    }
    // Push only, because emailing a whole team for one message is too easy to overdo.
    const rest = everyone.filter((id) => !named.includes(id));
    if (rest.length) {
      this.notifications
        .notifyMember({
          category: keys.category,
          push: {
            ...push,
            memberIds: rest,
            idempotencyKey: `${link.dedupe}:team`,
          },
        })
        .catch(() => undefined);
    }
    return new Set([...named, ...everyone]);
  }

  private async notifyNewTags(
    acc: SpaceAccess,
    tagged: TaggedBody,
    previousBody: string,
    authorId: string,
    link: { url: string; dedupe: string },
  ): Promise<void> {
    const before = parseMentions(previousBody);
    await this.notifyTagged(
      acc,
      {
        body: tagged.body,
        memberIds: tagged.memberIds.filter(
          (id) => !before.memberIds.includes(id),
        ),
        team: tagged.team && !before.team,
      },
      authorId,
      link,
    );
  }

  private async pushLeaderPost(
    acc: SpaceAccess,
    post: TeamPost,
    authorId: string,
    alreadyTold: Set<string>,
  ) {
    const [memberIds, author] = await Promise.all([
      this.access.memberIds(acc.space),
      this.spaceRepo.query(
        `SELECT NULLIF(TRIM(COALESCE(firstname, '') || ' ' || COALESCE(lastname, '')), '') AS name FROM members WHERE id = $1`,
        [authorId],
      ) as Promise<{ name: string | null }[]>,
    ]);
    const recipients = memberIds.filter(
      (id) => id !== authorId && !alreadyTold.has(id),
    );
    if (!recipients.length) return;
    // Lookups above run in the request; only the send itself is left to finish on its own.
    this.notifications
      .notifyMember({
        category: pushKeys(acc).category,
        push: {
          memberIds: recipients,
          key: pushKeys(acc).leaderPost,
          vars: {
            space_name: acc.name,
            author_name: author[0]?.name ?? 'Your leader',
            excerpt: excerpt(post.body),
          },
          url: `/team-spaces/post/${post.id}`,
          idempotencyKey: `team-post:${post.id}`,
        },
      })
      .catch(() => undefined);
  }

  private async pushReply(
    acc: SpaceAccess,
    post: TeamPost,
    reply: TeamPostReply,
    replierId: string,
    authorId: string,
  ) {
    const key = `team-reply-push:${post.id}`;
    if (await this.cacheService.get(key)) return;
    this.cacheService.set(key, true, REPLY_PUSH_THROTTLE_SECONDS);
    const replier = (await this.spaceRepo.query(
      `SELECT NULLIF(TRIM(COALESCE(firstname, '') || ' ' || COALESCE(lastname, '')), '') AS name FROM members WHERE id = $1`,
      [replierId],
    )) as { name: string | null }[];
    this.notifications
      .notifyMember({
        category: pushKeys(acc).category,
        push: {
          memberIds: [authorId],
          key: pushKeys(acc).reply,
          vars: {
            author_name: replier[0]?.name ?? 'Someone',
            space_name: acc.name,
            excerpt: excerpt(reply.body),
          },
          url: `/team-spaces/post/${post.id}`,
          idempotencyKey: `team-reply:${reply.id}`,
        },
      })
      .catch(() => undefined);
  }
}
