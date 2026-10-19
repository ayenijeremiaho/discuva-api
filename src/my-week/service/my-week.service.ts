import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Not, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { fromZonedTime } from 'date-fns-tz';
import { PrayerRosterEntry } from '../../prayer/entity/prayer-roster-entry.entity';
import {
  PrayerDayMode,
  PrayerMeetingStatus,
  PrayerRosterStatus,
} from '../../prayer/enum/prayer.enum';
import { SmallGroup } from '../../small-group/entity/small-group.entity';
import { MeetingFrequencyEnum } from '../../small-group/enum/meeting-frequency.enum';
import { nextMeeting } from '../../small-group/util/meeting-schedule';
import { scheduleOf } from '../../small-group/service/small-group.service';
import { ClassSession } from '../../classes/entity/class-session.entity';
import { EnrollmentStatusEnum } from '../../classes/enum/enrollment-status.enum';
import { ChurchClassStatusEnum } from '../../classes/enum/church-class-status.enum';
import { ChurchSettingsService } from '../../church-settings/service/church-settings.service';
import { PlanFeatureResolverService } from '../../billing/service/plan-feature-resolver.service';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { addDays, localDate } from '../../event/types/slot-blueprint';
import { TeamSpaceAccessService } from '../../team-space/service/team-space-access.service';

const DAY_MS = 24 * 3600 * 1000;
const WINDOW_DAYS = 7;

export interface MyWeekItem {
  kind: 'prayer' | 'fellowship' | 'class' | 'meeting' | 'duty';
  id: string;
  title: string;
  detail: string | null;
  // Leader or facilitator; null when attending.
  role: string | null;
  startsAt: string;
  endsAt: string | null;
  url: string;
}

// The member's own commitments for the next 7 days, outside services (the app already has those).
@Injectable()
export class MyWeekService {
  constructor(
    @InjectRepository(PrayerRosterEntry)
    private readonly rosterRepo: Repository<PrayerRosterEntry>,
    @InjectRepository(SmallGroup)
    private readonly groupRepo: Repository<SmallGroup>,
    @InjectRepository(ClassSession)
    private readonly sessionRepo: Repository<ClassSession>,
    private readonly churchSettings: ChurchSettingsService,
    private readonly planFeatures: PlanFeatureResolverService,
    private readonly churchTimezone: ChurchTimezoneService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly spaces: TeamSpaceAccessService,
  ) {}

  async forMember(
    memberId: string,
    workerProfileId: string | undefined,
    now = new Date(),
  ): Promise<MyWeekItem[]> {
    const timezone = await this.churchTimezone.get();
    const until = new Date(now.getTime() + WINDOW_DAYS * DAY_MS);
    const [prayer, fellowship, classes, meetings, duties] = await Promise.all([
      this.when('prayer', () =>
        this.prayer(memberId, workerProfileId, now, until, timezone),
      ),
      this.when('small_groups', () =>
        this.fellowships(memberId, now, until, timezone),
      ),
      this.when('classes', () => this.classes(memberId, now, until)),
      this.when('team_spaces', () => this.meetings(memberId, now, until)),
      this.when('serving_rota', () => this.duties(memberId, now, until)),
    ]);
    return [...prayer, ...fellowship, ...classes, ...meetings, ...duties].sort(
      (a, b) => a.startsAt.localeCompare(b.startsAt),
    );
  }

  private async when(
    module: string,
    load: () => Promise<MyWeekItem[]>,
  ): Promise<MyWeekItem[]> {
    if (!(await this.churchSettings.isEnabled(module))) return [];
    const tenantId = this.cls.get('tenantId');
    if (tenantId && (await this.planFeatures.gateReason(tenantId, module)))
      return [];
    return load();
  }

  private async prayer(
    memberId: string,
    workerProfileId: string | undefined,
    now: Date,
    until: Date,
    timezone: string,
  ): Promise<MyWeekItem[]> {
    const today = localDate(now, timezone);
    const rows = await this.rosterRepo
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.meeting', 'm')
      .innerJoinAndSelect('m.dayConfig', 'dc')
      .innerJoinAndSelect('m.program', 'p')
      .where(
        new Brackets((qb) => {
          qb.where('r.member_id = :memberId', { memberId });
          if (workerProfileId)
            qb.orWhere('r.worker_profile_id = :workerProfileId', {
              workerProfileId,
            });
        }),
      )
      .andWhere('r.status = :scheduled', {
        scheduled: PrayerRosterStatus.SCHEDULED,
      })
      .andWhere('m.status != :cancelled', {
        cancelled: PrayerMeetingStatus.CANCELLED,
      })
      .andWhere('m.date BETWEEN :from AND :to', {
        from: today,
        to: addDays(today, WINDOW_DAYS),
      })
      .getMany();
    return rows.flatMap((r) => {
      const startsAt = fromZonedTime(
        `${r.meeting.date}T${r.meeting.dayConfig.startTime}:00`,
        timezone,
      );
      const endsAt = fromZonedTime(
        `${r.meeting.date}T${r.meeting.dayConfig.endTime}:00`,
        timezone,
      );
      if (endsAt <= now || startsAt > until) return [];
      return [
        {
          kind: 'prayer' as const,
          id: r.id,
          title: r.meeting.program.name,
          detail:
            r.meeting.dayConfig.mode === PrayerDayMode.VIRTUAL
              ? 'Online'
              : 'In person',
          role: null,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          url: '/prayer',
        },
      ];
    });
  }

  private async fellowships(
    memberId: string,
    now: Date,
    until: Date,
    timezone: string,
  ): Promise<MyWeekItem[]> {
    const groups = await this.groupRepo
      .createQueryBuilder('g')
      .leftJoin('g.leader', 'leader')
      .addSelect('leader.id')
      .where('g.meetingFrequency != :none', { none: MeetingFrequencyEnum.NONE })
      .andWhere(
        new Brackets((qb) =>
          qb
            .where('g.leader_id = :memberId', { memberId })
            .orWhere(
              'EXISTS (SELECT 1 FROM small_group_members sgm WHERE sgm.group_id = g.id AND sgm.member_id = :memberId)',
              { memberId },
            ),
        ),
      )
      .getMany();
    return groups.flatMap((g) => {
      const at = nextMeeting(
        scheduleOf(g),
        new Date(now.getTime() - 1),
        timezone,
      );
      if (!at || at > until) return [];
      const end = g.meetingEndTime
        ? fromZonedTime(
            `${localDate(at, timezone)}T${g.meetingEndTime}:00`,
            timezone,
          )
        : null;
      return [
        {
          kind: 'fellowship' as const,
          id: g.id,
          title: g.name,
          detail: g.meetingLocation ?? (g.meetingLink ? 'Online' : null),
          role: g.leader?.id === memberId ? 'Leader' : null,
          startsAt: at.toISOString(),
          endsAt: end && end > at ? end.toISOString() : null,
          url: `/small-groups/${g.id}`,
        },
      ];
    });
  }

  // Team meetings in the member's spaces, leaving out ones they've said they can't make.
  private async meetings(
    memberId: string,
    now: Date,
    until: Date,
  ): Promise<MyWeekItem[]> {
    const memberships = await this.spaces.memberships(memberId);
    if (!memberships.length) return [];
    const rows = (await this.sessionRepo.query(
      `SELECT m.post_id, m.title, m.starts_at, m.ends_at, m.location, s.kind, s.ref_id
       FROM team_spaces s
       JOIN team_meetings m ON m.space_id = s.id AND m.cancelled_at IS NULL AND m.starts_at > $4 AND m.starts_at <= $5
       JOIN team_posts p ON p.id = m.post_id AND p.removed_at IS NULL
       WHERE (s.kind, s.ref_id) IN (SELECT * FROM unnest($1::varchar[], $2::uuid[]))
         AND NOT EXISTS (SELECT 1 FROM team_meeting_rsvps r WHERE r.meeting_id = m.post_id AND r.member_id = $3 AND r.response = 'NOT_GOING')`,
      [
        memberships.map((x) => x.kind),
        memberships.map((x) => x.refId),
        memberId,
        new Date(now.getTime() - 3600 * 1000),
        until,
      ],
    )) as {
      post_id: string;
      title: string;
      starts_at: Date;
      ends_at: Date | null;
      location: string | null;
      kind: string;
      ref_id: string;
    }[];
    const byRef = new Map(memberships.map((x) => [`${x.kind}:${x.refId}`, x]));
    return rows.map((r) => {
      const space = byRef.get(`${r.kind}:${r.ref_id}`);
      return {
        kind: 'meeting' as const,
        id: r.post_id,
        title: r.title,
        detail: [space?.name, r.location].filter(Boolean).join(' · ') || null,
        role: space?.isLeader ? 'Leader' : null,
        startsAt: new Date(r.starts_at).toISOString(),
        endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null,
        url: `/team-spaces/meeting/${r.post_id}`,
      };
    });
  }

  // Services the member is on the rota for.
  private async duties(
    memberId: string,
    now: Date,
    until: Date,
  ): Promise<MyWeekItem[]> {
    const rows = (await this.sessionRepo.query(
      `SELECT a.id, a.role, d.name AS department_name, ss.name, e.name AS event_name, ss.start_time, ss.end_time
       FROM rota_assignments a
       JOIN service_slots ss ON ss.id = a.service_slot_id
       JOIN events e ON e.id = ss.event_id
       JOIN departments d ON d.id = a.department_id
       WHERE a.member_id = $1 AND ss.end_time > $2 AND ss.start_time <= $3`,
      [memberId, now, until],
    )) as {
      id: string;
      role: string | null;
      department_name: string;
      name: string;
      event_name: string;
      start_time: Date;
      end_time: Date;
    }[];
    return rows.map((r) => ({
      kind: 'duty' as const,
      id: r.id,
      title:
        r.event_name && r.event_name !== r.name
          ? `${r.event_name} · ${r.name}`
          : r.name,
      detail: [r.department_name, r.role].filter(Boolean).join(' · '),
      role: 'Serving',
      startsAt: new Date(r.start_time).toISOString(),
      endsAt: new Date(r.end_time).toISOString(),
      url: '/rota',
    }));
  }

  private async classes(
    memberId: string,
    now: Date,
    until: Date,
  ): Promise<MyWeekItem[]> {
    const sessions = await this.sessionRepo
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.churchClass', 'c')
      .addSelect(
        `EXISTS (SELECT 1 FROM class_facilitators f WHERE f.church_class_id = c.id AND f.member_id = :memberId)`,
        'is_facilitator',
      )
      .where('c.status = :active', { active: ChurchClassStatusEnum.ACTIVE })
      .andWhere('s.startsAt <= :until', { until })
      .andWhere('COALESCE(s.endsAt, s.startsAt) >= :now', { now })
      .andWhere(
        new Brackets((qb) =>
          qb
            .where(
              'EXISTS (SELECT 1 FROM class_facilitators f WHERE f.church_class_id = c.id AND f.member_id = :memberId)',
            )
            .orWhere(
              'EXISTS (SELECT 1 FROM class_enrollments e WHERE e.church_class_id = c.id AND e.member_id = :memberId AND e.status = :inProgress)',
              { inProgress: EnrollmentStatusEnum.IN_PROGRESS },
            ),
        ),
      )
      .setParameter('memberId', memberId)
      .getRawAndEntities();
    return sessions.entities.map((s, i) => ({
      kind: 'class' as const,
      id: s.id,
      title: s.churchClass.name,
      detail: s.title ?? s.location ?? null,
      role: sessions.raw[i]?.is_facilitator ? 'Facilitator' : null,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt?.toISOString() ?? null,
      url: `/classes/${s.churchClass.id}`,
    }));
  }
}
