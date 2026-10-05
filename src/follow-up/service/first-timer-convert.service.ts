import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, QueryFailedError, Repository } from 'typeorm';
import { FirstTimer } from '../entity/first-timer.entity';
import { Convert } from '../../evangelism/entity/convert.entity';
import { ConvertFollowUpLog } from '../../evangelism/entity/convert-follow-up-log.entity';
import { Member } from '../../member/entity/member.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { CacheService } from '../../utility/service/cache.service';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import type { FirstTimerTimelineEntry } from './follow-up.service';

const MATCH_LIMIT = 5;
const UNIQUE_VIOLATION = '23505';
// Kept as literals: importing the evangelism services would make FollowUpModule ↔ EvangelismModule circular.
const EVANGELISM_REPORT_NAMESPACE = 'evangelism:report';
const FOLLOW_UP_REPORT_NAMESPACE = 'follow-up:report';

export interface ConvertMatch {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  onboardedByName: string;
  outreach: { id: string; title: string | null; outreachDate: string } | null;
  lastContactedAt: Date | null;
  createdAt: Date;
  matchedOn: 'phone' | 'name';
}

export interface LinkedConvert extends Omit<ConvertMatch, 'matchedOn'> {
  firstTimerLinkedAt: Date | null;
  followUpCount: number;
}

// The bridge from an outreach convert to the first-timer they became: Follow-Up confirms the match, then owns the follow-up.
@Injectable()
export class FirstTimerConvertService {
  constructor(
    @InjectRepository(FirstTimer)
    private readonly firstTimerRepo: Repository<FirstTimer>,
    @InjectRepository(Convert)
    private readonly convertRepo: Repository<Convert>,
    @InjectRepository(ConvertFollowUpLog)
    private readonly convertLogRepo: Repository<ConvertFollowUpLog>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    private readonly auditLogService: AuditLogService,
    private readonly cacheService: CacheService,
    private readonly notificationDispatchService: NotificationDispatchService,
  ) {}

  async findMatches(ft: FirstTimer): Promise<ConvertMatch[]> {
    const fullName = `${ft.firstname} ${ft.lastname}`.trim();
    const qb = this.convertRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.outreach', 'o')
      .where('c.first_timer_id IS NULL')
      .andWhere('c.member_id IS NULL')
      .andWhere(
        new Brackets((w) => {
          w.where('c.phone = :phone', { phone: ft.phone });
          w.orWhere('(c.phone IS NULL AND LOWER(c.name) = LOWER(:fullName))', {
            fullName,
          });
        }),
      )
      .orderBy('c.created_at', 'DESC')
      .take(MATCH_LIMIT);
    if (ft.dismissedConvertIds?.length) {
      qb.andWhere('c.id NOT IN (:...dismissed)', {
        dismissed: ft.dismissedConvertIds,
      });
    }
    const converts = await qb.getMany();
    return converts.map((c) => ({
      ...summarise(c),
      matchedOn: c.phone && c.phone === ft.phone ? 'phone' : 'name',
    }));
  }

  // One query for a page of first-timers; drives the list's "Met on outreach?" badge.
  async findIdsWithMatches(firstTimers: FirstTimer[]): Promise<Set<string>> {
    if (!firstTimers.length) return new Set();
    const rows = await this.convertRepo.query(
      `SELECT DISTINCT ft.id
       FROM first_timers ft
       JOIN converts c
         ON c.first_timer_id IS NULL
        AND c.member_id IS NULL
        AND NOT (c.id = ANY(ft.dismissed_convert_ids))
        AND (c.phone = ft.phone
             OR (c.phone IS NULL AND LOWER(c.name) = LOWER(ft.firstname || ' ' || ft.lastname)))
       WHERE ft.id = ANY($1)
         AND NOT EXISTS (SELECT 1 FROM converts lc WHERE lc.first_timer_id = ft.id)`,
      [firstTimers.map((f) => f.id)],
    );
    return new Set((rows as { id: string }[]).map((r) => r.id));
  }

  async findLinked(firstTimerId: string): Promise<LinkedConvert | null> {
    const convert = await this.convertRepo.findOne({
      where: { firstTimer: { id: firstTimerId } },
      relations: ['outreach'],
    });
    if (!convert) return null;
    const followUpCount = await this.convertLogRepo.count({
      where: { convert: { id: convert.id } },
    });
    return {
      ...summarise(convert),
      firstTimerLinkedAt: convert.firstTimerLinkedAt,
      followUpCount,
    };
  }

  // The convert's outreach and evangelism contacts, ahead of the first-timer's own visits.
  async timelineEntries(
    firstTimerId: string,
  ): Promise<FirstTimerTimelineEntry[]> {
    const convert = await this.convertRepo.findOne({
      where: { firstTimer: { id: firstTimerId } },
      relations: ['outreach', 'outreach.team'],
    });
    if (!convert) return [];
    const logs = await this.convertLogRepo.find({
      where: { convert: { id: convert.id } },
      order: { contactedAt: 'ASC' },
    });
    // The hand-over log itself is shown by the first-timer's own initial visit.
    const cutoff = convert.firstTimerLinkedAt?.getTime() ?? Infinity;
    const team = (convert.outreach?.team ?? [])
      .map((m) => `${m.firstname} ${m.lastname}`)
      .join(', ');
    return [
      {
        source: 'OUTREACH_MET',
        label: convert.outreach?.title
          ? `Met on outreach: ${convert.outreach.title}`
          : 'Met on outreach',
        occurredAt: convert.createdAt,
        notes: team ? `By ${team}` : `By ${convert.onboardedByName}`,
      },
      ...logs
        .filter((l) => new Date(l.contactedAt).getTime() < cutoff)
        .map((l) => ({
          source: 'EVANGELISM_FOLLOW_UP' as const,
          label: `Contacted by ${l.loggedByName}`,
          occurredAt: l.contactedAt,
          notes: l.note,
        })),
    ];
  }

  async link(
    firstTimerId: string,
    convertId: string,
    actorMemberId: string,
  ): Promise<LinkedConvert> {
    const [ft, convert, actor] = await Promise.all([
      this.firstTimerRepo.findOne({ where: { id: firstTimerId } }),
      this.convertRepo.findOne({
        where: { id: convertId },
        relations: [
          'onboardedBy',
          'outreach',
          'outreach.team',
          'assignedTo',
          'assignedTo.member',
          'firstTimer',
          'member',
        ],
      }),
      this.memberRepo.findOne({
        where: { id: actorMemberId },
        select: { id: true, firstname: true, lastname: true },
      }),
    ]);
    if (!ft) throw new NotFoundException('First-timer not found');
    if (!convert) throw new NotFoundException('Convert not found');
    if (convert.firstTimer) {
      throw new ConflictException(
        'This convert is already linked to a first-timer',
      );
    }
    if (convert.member) {
      throw new ConflictException('This convert has already joined the church');
    }
    if (await this.convertRepo.existsBy({ firstTimer: { id: firstTimerId } })) {
      throw new ConflictException(
        'This first-timer is already linked to a convert',
      );
    }

    const previousAssignee = convert.assignedTo?.member?.id ?? null;
    const now = new Date();
    convert.firstTimer = { id: ft.id } as FirstTimer;
    convert.firstTimerLinkedAt = now;
    convert.assignedTo = null;
    convert.lastContactedAt = now;
    try {
      await this.convertRepo.save(convert);
    } catch (err) {
      // Two Follow-Up workers confirming at once: UQ_converts_first_timer_id rejects the second.
      if (
        err instanceof QueryFailedError &&
        (err as { code?: string }).code === UNIQUE_VIOLATION
      ) {
        throw new ConflictException(
          'This first-timer is already linked to a convert',
        );
      }
      throw err;
    }
    await this.convertLogRepo.save(
      this.convertLogRepo.create({
        convert: { id: convert.id } as Convert,
        loggedBy: actor ? ({ id: actor.id } as Member) : null,
        loggedByName: actor
          ? `${actor.firstname} ${actor.lastname}`
          : 'Follow-Up team',
        note: 'Visited church as a first-timer. The Follow-Up team has taken over.',
        contactedAt: now,
      }),
    );

    this.auditLogService.log('CONVERT_LINKED_TO_FIRST_TIMER', {
      actorId: actorMemberId,
      targetId: convert.id,
      targetName: convert.name,
      metadata: { firstTimerId: ft.id },
    });
    this.flushReports();

    const recipients = new Set<string>(
      [
        previousAssignee,
        convert.onboardedBy?.id ?? null,
        ...(convert.outreach?.team ?? []).map((m) => m.id),
      ].filter((id): id is string => !!id && id !== actorMemberId),
    );
    if (recipients.size) {
      this.notificationDispatchService.notifyMember({
        category: EmailCategory.EVANGELISM,
        push: {
          memberIds: [...recipients],
          key: PushNotificationKey.CONVERT_VISITED_CHURCH,
          vars: { convert_name: convert.name },
          idempotencyKey: `convert-visited-church:${convert.id}`,
        },
      });
    }

    return (await this.findLinked(ft.id))!;
  }

  async dismiss(firstTimerId: string, convertId: string): Promise<void> {
    const ft = await this.firstTimerRepo.findOne({
      where: { id: firstTimerId },
    });
    if (!ft) throw new NotFoundException('First-timer not found');
    const dismissed = new Set(ft.dismissedConvertIds ?? []);
    if (dismissed.has(convertId)) return;
    dismissed.add(convertId);
    ft.dismissedConvertIds = [...dismissed];
    await this.firstTimerRepo.save(ft);
  }

  async unlink(firstTimerId: string, actorMemberId: string): Promise<void> {
    const convert = await this.convertRepo.findOne({
      where: { firstTimer: { id: firstTimerId } },
    });
    if (!convert)
      throw new NotFoundException('No convert is linked to this first-timer');
    convert.firstTimer = null;
    convert.firstTimerLinkedAt = null;
    await this.convertRepo.save(convert);

    this.auditLogService.log('CONVERT_UNLINKED_FROM_FIRST_TIMER', {
      actorId: actorMemberId,
      targetId: convert.id,
      targetName: convert.name,
      metadata: { firstTimerId },
    });
    this.flushReports();
  }

  // Joining the church is recorded once: marking the first-timer converted also closes its convert.
  async propagateMembership(
    firstTimerId: string,
    memberId: string,
    actorMemberId?: string,
  ): Promise<void> {
    const convert = await this.convertRepo.findOne({
      where: { firstTimer: { id: firstTimerId } },
      relations: ['member'],
    });
    if (!convert || convert.member) return;
    convert.member = { id: memberId } as Member;
    convert.linkedAt = new Date();
    await this.convertRepo.save(convert);
    this.auditLogService.log('CONVERT_LINKED_TO_MEMBER', {
      actorId: actorMemberId,
      targetId: convert.id,
      targetName: convert.name,
      metadata: { memberId, via: 'first_timer', firstTimerId },
    });
    this.flushReports();
  }

  private flushReports(): void {
    this.cacheService.flushNamespace(EVANGELISM_REPORT_NAMESPACE);
    this.cacheService.flushNamespace(FOLLOW_UP_REPORT_NAMESPACE);
  }
}

function summarise(c: Convert): Omit<ConvertMatch, 'matchedOn'> {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    status: c.status,
    onboardedByName: c.onboardedByName,
    outreach: c.outreach
      ? {
          id: c.outreach.id,
          title: c.outreach.title,
          outreachDate: c.outreach.outreachDate,
        }
      : null,
    lastContactedAt: c.lastContactedAt,
    createdAt: c.createdAt,
  };
}
