import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TeamPostReaction } from '../entity/team-post-reaction.entity';
import { TeamSpaceAccessService } from './team-space-access.service';
import { TeamSpace } from '../entity/team-space.entity';

export const REACTIONS = ['👍', '❤️', '🙏', '😂', '🎉'] as const;

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
}

export type ReactionTarget = { postId: string } | { replyId: string };

const ORDER = new Map<string, number>(REACTIONS.map((e, i) => [e, i]));

// Quick emoji reactions on posts and replies. They never notify anyone.
@Injectable()
export class TeamSpaceReactionService {
  constructor(
    @InjectRepository(TeamPostReaction)
    private readonly repo: Repository<TeamPostReaction>,
    private readonly access: TeamSpaceAccessService,
  ) {}

  // Counts for a page of posts and replies, in one query each.
  async summaries(
    memberId: string,
    postIds: string[],
    replyIds: string[] = [],
  ): Promise<Map<string, ReactionSummary[]>> {
    const byTarget = new Map<string, ReactionSummary[]>();
    if (!postIds.length && !replyIds.length) return byTarget;
    const run = (column: 'post_id' | 'reply_id', ids: string[]) =>
      ids.length
        ? (this.repo.query(
            `SELECT ${column} AS target_id, emoji, count(*)::int AS count, bool_or(member_id = $1) AS mine
             FROM team_post_reactions
             WHERE ${column} = ANY($2::uuid[]) ${column === 'post_id' ? 'AND reply_id IS NULL' : ''}
             GROUP BY ${column}, emoji`,
            [memberId, ids],
          ) as Promise<
            { target_id: string; emoji: string; count: number; mine: boolean }[]
          >)
        : Promise.resolve([]);
    const [posts, replies] = await Promise.all([
      run('post_id', postIds),
      run('reply_id', replyIds),
    ]);
    for (const r of [...posts, ...replies]) {
      const list = byTarget.get(r.target_id) ?? [];
      list.push({ emoji: r.emoji, count: r.count, mine: !!r.mine });
      byTarget.set(r.target_id, list);
    }
    for (const list of byTarget.values())
      list.sort(
        (a, b) => (ORDER.get(a.emoji) ?? 99) - (ORDER.get(b.emoji) ?? 99),
      );
    return byTarget;
  }

  // Adds the reaction, or takes it away if the member already gave it.
  async toggle(memberId: string, target: ReactionTarget, emoji: string) {
    if (!(REACTIONS as readonly string[]).includes(emoji))
      throw new BadRequestException('Pick one of the reactions offered.');
    const { postId, replyId, space } = await this.resolve(target);
    this.access.assertOpen(await this.access.accessBySpace(memberId, space));
    const added = (await (replyId
      ? this.repo.query(
          `INSERT INTO team_post_reactions (post_id, reply_id, member_id, emoji) VALUES ($1, $2, $3, $4)
           ON CONFLICT (reply_id, member_id, emoji) WHERE reply_id IS NOT NULL DO NOTHING RETURNING id`,
          [postId, replyId, memberId, emoji],
        )
      : this.repo.query(
          `INSERT INTO team_post_reactions (post_id, member_id, emoji) VALUES ($1, $2, $3)
           ON CONFLICT (post_id, member_id, emoji) WHERE reply_id IS NULL DO NOTHING RETURNING id`,
          [postId, memberId, emoji],
        ))) as { id: string }[];
    if (!added.length)
      await this.repo.query(
        replyId
          ? `DELETE FROM team_post_reactions WHERE reply_id = $1 AND member_id = $2 AND emoji = $3`
          : `DELETE FROM team_post_reactions WHERE post_id = $1 AND reply_id IS NULL AND member_id = $2 AND emoji = $3`,
        [replyId ?? postId, memberId, emoji],
      );
    const summary = await this.summaries(
      memberId,
      replyId ? [] : [postId],
      replyId ? [replyId] : [],
    );
    return { reactions: summary.get(replyId ?? postId) ?? [] };
  }

  // Who reacted with what, for the reactions sheet.
  async who(memberId: string, target: ReactionTarget) {
    const { postId, replyId, space } = await this.resolve(target);
    await this.access.accessBySpace(memberId, space);
    const rows = (await this.repo.query(
      `SELECT r.emoji, m.id, NULLIF(TRIM(COALESCE(m.firstname, '') || ' ' || COALESCE(m.lastname, '')), '') AS name, m.photo_url
       FROM team_post_reactions r JOIN members m ON m.id = r.member_id
       WHERE ${replyId ? 'r.reply_id = $1' : 'r.post_id = $1 AND r.reply_id IS NULL'}
       ORDER BY r.created_at
       LIMIT 500`,
      [replyId ?? postId],
    )) as {
      emoji: string;
      id: string;
      name: string | null;
      photo_url: string | null;
    }[];
    const groups = new Map<
      string,
      { id: string; name: string; photoUrl: string | null }[]
    >();
    for (const r of rows)
      groups.set(r.emoji, [
        ...(groups.get(r.emoji) ?? []),
        { id: r.id, name: r.name ?? 'A member', photoUrl: r.photo_url },
      ]);
    return {
      reactions: [...groups.entries()]
        .sort(([a], [b]) => (ORDER.get(a) ?? 99) - (ORDER.get(b) ?? 99))
        .map(([emoji, people]) => ({ emoji, people })),
    };
  }

  private async resolve(target: ReactionTarget) {
    if ('replyId' in target) {
      const rows = (await this.repo.query(
        `SELECT r.post_id, s.id AS space_id, s.kind, s.ref_id FROM team_post_replies r
         JOIN team_posts p ON p.id = r.post_id AND p.removed_at IS NULL
         JOIN team_spaces s ON s.id = p.space_id
         WHERE r.id = $1 AND r.removed_at IS NULL`,
        [target.replyId],
      )) as {
        post_id: string;
        space_id: string;
        kind: string;
        ref_id: string;
      }[];
      if (!rows[0]) throw new NotFoundException('Reply not found');
      return {
        postId: rows[0].post_id,
        replyId: target.replyId,
        space: {
          id: rows[0].space_id,
          kind: rows[0].kind,
          refId: rows[0].ref_id,
        } as TeamSpace,
      };
    }
    const rows = (await this.repo.query(
      `SELECT s.id AS space_id, s.kind, s.ref_id FROM team_posts p JOIN team_spaces s ON s.id = p.space_id
       WHERE p.id = $1 AND p.removed_at IS NULL`,
      [target.postId],
    )) as { space_id: string; kind: string; ref_id: string }[];
    if (!rows[0]) throw new NotFoundException('Post not found');
    return {
      postId: target.postId,
      replyId: null,
      space: {
        id: rows[0].space_id,
        kind: rows[0].kind,
        refId: rows[0].ref_id,
      } as TeamSpace,
    };
  }
}
