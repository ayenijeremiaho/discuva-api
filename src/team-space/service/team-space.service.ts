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
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const AUTHOR_SQL = `a.id AS author_id, NULLIF(TRIM(COALESCE(a.firstname, '') || ' ' || COALESCE(a.lastname, '')), '') AS author_name, a.photo_url AS author_photo`;

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
    const [pinned, upcomingMeetings] = await Promise.all([
      this.postRows(acc.space.id, { pinned: true }),
      this.extras.upcoming(acc.space.id),
      this.markRead(memberId, acc.space.id),
    ]);
    const details = await this.extras.details(pinned, memberId);
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
        !acc.closed && !minor && (!acc.space.leadersOnly || acc.isLeader),
      pinned: pinned.map((p) => this.toPost(p, memberId, acc, details)),
      upcomingMeetings,
    };
  }

  async feed(
    memberId: string,
    kind: TeamSpaceKindEnum,
    refId: string,
    cursor?: string,
  ) {
    const acc = await this.access.access(memberId, kind, refId);
    const rows = await this.postRows(acc.space.id, {
      pinned: false,
      after: decodeCursor(cursor),
    });
    const page = rows.slice(0, FEED_PAGE_SIZE);
    const last = page[page.length - 1];
    const details = await this.extras.details(page, memberId);
    return {
      items: page.map((p) => this.toPost(p, memberId, acc, details)),
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
    now = new Date(),
  ) {
    const [acc, minor] = await Promise.all([
      this.access.access(memberId, kind, refId),
      this.access.isMinor(memberId),
    ]);
    this.access.assertOpen(acc);
    if (minor)
      throw new ForbiddenException(
        'Members under 18 can read and reply to posts, but not start them.',
      );
    if (acc.space.leadersOnly && !acc.isLeader)
      throw new ForbiddenException(
        'Only leaders can start posts in this space. You can reply to any post.',
      );
    const post = await this.postRepo.save(
      this.postRepo.create({
        space: { id: acc.space.id } as TeamSpace,
        author: { id: memberId } as Member,
        body,
        lastActivityAt: now,
      }),
    );
    await Promise.all([
      this.spaceRepo.update(acc.space.id, { lastActivityAt: now }),
      this.markRead(memberId, acc.space.id, now),
    ]);
    // Leaders' posts go out straight away; everyone else's wait for the evening summary.
    if (acc.isLeader) await this.pushLeaderPost(acc, post, memberId);
    return { id: post.id };
  }

  async editPost(
    memberId: string,
    postId: string,
    body: string,
    now = new Date(),
  ) {
    const post = await this.findPost(postId);
    if (post.author?.id !== memberId)
      throw new ForbiddenException('You can only edit your own posts.');
    await this.postRepo.update(postId, { body, editedAt: now });
    return { ok: true };
  }

  async removePost(memberId: string, postId: string, now = new Date()) {
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
    if (!own)
      this.audit.log('TEAM_POST_REMOVED', {
        actorId: memberId,
        targetId: post.author?.id,
        metadata: { postId, space: acc.name, kind: acc.kind },
      });
    return { ok: true };
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
        `SELECT p.id, p.type, p.body, p.pinned, p.reply_count, p.last_activity_at, p.created_at, p.edited_at, ${AUTHOR_SQL}
         FROM team_posts p LEFT JOIN members a ON a.id = p.author_id WHERE p.id = $1`,
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
    const [minor, details] = await Promise.all([
      this.access.isMinor(memberId),
      this.extras.details(postRow, memberId),
    ]);
    return {
      space: { kind: acc.kind, refId: acc.refId, name: acc.name },
      post: this.toPost(postRow[0], memberId, acc, details),
      canReply: !acc.closed,
      isUnder18: minor,
      replies: page.map((r) => ({
        id: r.id,
        body: r.body,
        createdAt: r.created_at,
        editedAt: r.edited_at,
        author: this.author(r),
        mine: r.author_id === memberId,
        canRemove: r.author_id === memberId || acc.isLeader,
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
    const reply = await this.replyRepo.save(
      this.replyRepo.create({
        post: { id: postId } as TeamPost,
        author: { id: memberId } as Member,
        body,
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
    const authorId = post.author?.id;
    if (authorId && authorId !== memberId)
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
      relations: { author: true },
    });
    if (!reply || reply.removedAt)
      throw new NotFoundException('Reply not found');
    if (reply.author?.id !== memberId)
      throw new ForbiddenException('You can only edit your own replies.');
    await this.replyRepo.update(replyId, { body, editedAt: now });
    return { ok: true };
  }

  async removeReply(memberId: string, replyId: string, now = new Date()) {
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
    if (!own)
      this.audit.log('TEAM_POST_REMOVED', {
        actorId: memberId,
        targetId: reply.author?.id,
        metadata: {
          replyId,
          postId: reply.post.id,
          space: acc.name,
          kind: acc.kind,
        },
      });
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
    opts: { pinned: boolean; after?: { at: Date; id: string } | null },
  ): Promise<PostRow[]> {
    const { after } = opts;
    return this.spaceRepo.query(
      `SELECT p.id, p.type, p.body, p.pinned, p.reply_count, p.last_activity_at, p.created_at, p.edited_at, ${AUTHOR_SQL}
       FROM team_posts p LEFT JOIN members a ON a.id = p.author_id
       WHERE p.space_id = $1 AND p.removed_at IS NULL AND p.pinned = $2
         ${after ? 'AND (p.last_activity_at, p.id) < ($4, $5)' : ''}
       ORDER BY p.last_activity_at DESC, p.id DESC
       LIMIT $3`,
      after
        ? [spaceId, opts.pinned, FEED_PAGE_SIZE + 1, after.at, after.id]
        : [spaceId, opts.pinned, opts.pinned ? MAX_PINNED : FEED_PAGE_SIZE + 1],
    ) as Promise<PostRow[]>;
  }

  private toPost(
    p: PostRow,
    memberId: string,
    acc: SpaceAccess,
    details: {
      meetings: Map<string, MeetingView>;
      polls: Map<string, PollView>;
    },
  ) {
    return {
      id: p.id,
      type: p.type,
      meeting: details.meetings.get(p.id) ?? null,
      poll: details.polls.get(p.id) ?? null,
      body: p.body,
      pinned: p.pinned,
      replyCount: Number(p.reply_count),
      createdAt: p.created_at,
      lastActivityAt: p.last_activity_at,
      editedAt: p.edited_at,
      author: this.author(p),
      mine: p.author_id === memberId,
      canRemove: p.author_id === memberId || acc.isLeader,
      canPin: acc.isLeader,
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

  private async pushLeaderPost(
    acc: SpaceAccess,
    post: TeamPost,
    authorId: string,
  ) {
    const [memberIds, author] = await Promise.all([
      this.access.memberIds(acc.space),
      this.spaceRepo.query(
        `SELECT NULLIF(TRIM(COALESCE(firstname, '') || ' ' || COALESCE(lastname, '')), '') AS name FROM members WHERE id = $1`,
        [authorId],
      ) as Promise<{ name: string | null }[]>,
    ]);
    const recipients = memberIds.filter((id) => id !== authorId);
    if (!recipients.length) return;
    // Lookups above run in the request; only the send itself is left to finish on its own.
    this.notifications
      .notifyMember({
        category: EmailCategory.TEAM_SPACES,
        push: {
          memberIds: recipients,
          key: PushNotificationKey.TEAM_SPACE_LEADER_POST,
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
        category: EmailCategory.TEAM_SPACES,
        push: {
          memberIds: [authorId],
          key: PushNotificationKey.TEAM_SPACE_REPLY,
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
