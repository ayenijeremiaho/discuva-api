import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { fromZonedTime } from 'date-fns-tz';
import { TeamSpace, TeamSpaceKindEnum } from '../entity/team-space.entity';
import { TeamSpaceAccessService } from './team-space-access.service';
import { DIGEST_HOUR } from '../constant/team-space.constant';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { CacheService } from '../../utility/service/cache.service';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { addDays, localDate } from '../../event/types/slot-blueprint';

const DAY_MS = 24 * 3600 * 1000;

export function digestSummary(counts: { name: string; n: number }[]): string {
  const total = counts.reduce((s, c) => s + c.n, 0);
  const names = [...counts].sort((a, b) => b.n - a.n).map((c) => c.name);
  const where =
    names.length <= 2
      ? names.join(' and ')
      : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  return `${total} new in ${where}`;
}

// Once each evening: what each member hasn't read today in their spaces, by others.
@Injectable()
export class TeamSpaceDigestService {
  constructor(
    @InjectRepository(TeamSpace)
    private readonly spaceRepo: Repository<TeamSpace>,
    private readonly access: TeamSpaceAccessService,
    private readonly churchTimezone: ChurchTimezoneService,
    private readonly cacheService: CacheService,
    private readonly notifications: NotificationDispatchService,
  ) {}

  // Returns when it's next due: this evening, or tomorrow evening once sent.
  async run(now = new Date()): Promise<Date> {
    const timezone = await this.churchTimezone.get();
    const today = localDate(now, timezone);
    const at = (date: string) =>
      fromZonedTime(
        `${date}T${String(DIGEST_HOUR).padStart(2, '0')}:00:00`,
        timezone,
      );
    const tonight = at(today);
    const tomorrow = at(addDays(today, 1));
    if (now < tonight) return tonight;
    const sentKey = `team-space-digest:${today}`;
    if (await this.cacheService.get(sentKey)) return tomorrow;
    this.cacheService.set(sentKey, true, 2 * 24 * 3600);

    const since = new Date(now.getTime() - DAY_MS);
    const spaces = await this.spaceRepo.find({
      where: { lastActivityAt: MoreThan(since) },
    });
    if (!spaces.length) return tomorrow;
    const spaceIds = spaces.map((s) => s.id);

    const [items, reads, names] = await Promise.all([
      this.spaceRepo.query(
        `SELECT p.space_id, p.author_id, p.created_at FROM team_posts p
         WHERE p.space_id = ANY($1) AND p.removed_at IS NULL AND p.last_activity_at > $2 AND p.created_at > $2
         UNION ALL
         SELECT p.space_id, r.author_id, r.created_at FROM team_posts p
         JOIN team_post_replies r ON r.post_id = p.id AND r.removed_at IS NULL AND r.created_at > $2
         WHERE p.space_id = ANY($1) AND p.removed_at IS NULL AND p.last_activity_at > $2`,
        [spaceIds, since],
      ) as Promise<
        { space_id: string; author_id: string | null; created_at: Date }[]
      >,
      this.spaceRepo.query(
        `SELECT member_id, space_id, last_read_at FROM team_space_reads WHERE space_id = ANY($1)`,
        [spaceIds],
      ) as Promise<
        { member_id: string; space_id: string; last_read_at: Date }[]
      >,
      this.spaceNames(spaces),
    ]);
    if (!items.length) return tomorrow;

    const lastRead = new Map(
      reads.map((r) => [
        `${r.member_id}:${r.space_id}`,
        new Date(r.last_read_at),
      ]),
    );
    const perMember = new Map<string, { name: string; n: number }[]>();
    for (const space of spaces) {
      const spaceItems = items.filter((i) => i.space_id === space.id);
      if (!spaceItems.length) continue;
      for (const memberId of await this.access.memberIds(space)) {
        const seenUntil = lastRead.get(`${memberId}:${space.id}`);
        const n = spaceItems.filter(
          (i) =>
            i.author_id !== memberId &&
            (!seenUntil || new Date(i.created_at) > seenUntil),
        ).length;
        if (!n) continue;
        const list = perMember.get(memberId) ?? [];
        list.push({ name: names.get(space.id) ?? 'your team', n });
        perMember.set(memberId, list);
      }
    }

    // Members whose summary reads the same share one send.
    const bySummary = new Map<string, string[]>();
    for (const [memberId, counts] of perMember) {
      const summary = digestSummary(counts);
      bySummary.set(summary, [...(bySummary.get(summary) ?? []), memberId]);
    }
    for (const [summary, memberIds] of bySummary)
      this.notifications
        .notifyMember({
          category: EmailCategory.TEAM_SPACES,
          push: {
            memberIds,
            key: PushNotificationKey.TEAM_SPACE_DIGEST,
            vars: { summary },
            url: '/team-spaces',
            idempotencyKey: `team-space-digest:${today}`,
          },
        })
        .catch(() => undefined);
    return tomorrow;
  }

  private async spaceNames(spaces: TeamSpace[]): Promise<Map<string, string>> {
    const ids = (kind: TeamSpaceKindEnum) =>
      spaces.filter((s) => s.kind === kind).map((s) => s.refId);
    const [departments, groups, opportunities] = await Promise.all([
      this.spaceRepo.query(
        `SELECT id, name FROM departments WHERE id = ANY($1)`,
        [ids(TeamSpaceKindEnum.DEPARTMENT)],
      ) as Promise<{ id: string; name: string }[]>,
      this.spaceRepo.query(
        `SELECT id, name FROM small_groups WHERE id = ANY($1)`,
        [ids(TeamSpaceKindEnum.FELLOWSHIP)],
      ) as Promise<{ id: string; name: string }[]>,
      this.spaceRepo.query(
        `SELECT id, title AS name FROM volunteer_opportunities WHERE id = ANY($1)`,
        [ids(TeamSpaceKindEnum.VOLUNTEERING)],
      ) as Promise<{ id: string; name: string }[]>,
    ]);
    const byRef = new Map(
      [...departments, ...groups, ...opportunities].map((r) => [r.id, r.name]),
    );
    return new Map(
      spaces.map((s) => [s.id, byRef.get(s.refId) ?? 'your team']),
    );
  }
}
