import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Member } from '../entity/member.entity';
import { Department } from '../../department/entity/department.entity';
import {
  AuditLogService,
  AuditAction,
} from '../../utility/service/audit-log.service';
import { FollowUpService } from '../../follow-up/service/follow-up.service';
import {
  MemberTimelineEvent,
  MemberTimelineEventType,
} from '../interface/member-timeline-event.interface';

// Only audit actions that are (a) genuinely targeted at the member (not a
// department/convert row with the memberId buried in metadata, which
// AuditLogService.findAll can't filter by), and (b) meaningful enough to
// belong on a "digital footprint" — noisy ones like MEMBER_UPDATED,
// MEMBER_LOGIN, or the generic WORKER_PROFILE_UPDATED (fires for any
// profile field edit, no clean before/after) are deliberately left out.
const MILESTONE_ACTIONS: AuditAction[] = [
  'MEMBER_ACTIVATED',
  'MEMBER_DEACTIVATED',
  'WORKER_PROMOTED',
  'WORKER_REINSTATED',
  'WORKER_REVOKED',
  'WORKER_TRAINEE_DEMOTED',
  'CLERGY_ASSIGNED',
  'CLERGY_TITLE_CHANGED',
  'CLERGY_REMOVED',
];

@Injectable()
export class MemberTimelineService {
  constructor(
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    @InjectRepository(Department)
    private readonly departmentRepo: Repository<Department>,
    private readonly auditLogService: AuditLogService,
    private readonly followUpService: FollowUpService,
  ) {}

  async getTimeline(memberId: string): Promise<MemberTimelineEvent[]> {
    const member = await this.memberRepo.findOne({
      where: { id: memberId },
      relations: ['workerProfile', 'workerProfile.department'],
    });
    if (!member) throw new NotFoundException('Member not found');

    const events: MemberTimelineEvent[] = [];

    const firstTimer =
      await this.followUpService.getFirstTimerByConvertedMemberId(memberId);

    if (firstTimer) {
      events.push({
        type: MemberTimelineEventType.FIRST_VISIT,
        title: 'First Visit',
        description: firstTimer.visitedEvent?.name ?? null,
        occurredAt: firstTimer.createdAt.toISOString(),
      });
      for (const visit of firstTimer.visits ?? []) {
        events.push({
          type: MemberTimelineEventType.REPEAT_VISIT,
          title: 'Visited Again',
          description: visit.event?.name ?? null,
          occurredAt: new Date(visit.visitedAt).toISOString(),
        });
      }
      if (firstTimer.convertedAt) {
        events.push({
          type: MemberTimelineEventType.BECAME_MEMBER,
          title: 'Became a Member',
          description: null,
          occurredAt: firstTimer.convertedAt.toISOString(),
        });
      }
    } else {
      // No first-timer record (e.g. created directly by an admin, bulk
      // import, or self-signup outside the visitor pipeline) — the join
      // date is the only "became a member" signal available.
      events.push({
        type: MemberTimelineEventType.BECAME_MEMBER,
        title: 'Joined the Church',
        description: null,
        occurredAt: (member.dateJoinedChurch ?? member.createdAt).toISOString(),
      });
    }

    const { data: logs } = await this.auditLogService.findAll(1, 200, {
      targetId: memberId,
    });
    const milestoneLogs = logs.filter((l) =>
      MILESTONE_ACTIONS.includes(l.action as AuditAction),
    );

    const departmentIds = [
      ...new Set(
        milestoneLogs
          .map((l) => (l.metadata as { departmentId?: string })?.departmentId)
          .filter((id): id is string => !!id),
      ),
    ];
    const departments = departmentIds.length
      ? await this.departmentRepo.find({ where: { id: In(departmentIds) } })
      : [];
    const departmentNameById = new Map(departments.map((d) => [d.id, d.name]));

    let sawWorkerPromotion = false;
    for (const log of milestoneLogs) {
      const metadata = (log.metadata ?? {}) as {
        departmentId?: string;
        clergyTitleName?: string;
      };
      const departmentName = metadata.departmentId
        ? (departmentNameById.get(metadata.departmentId) ?? null)
        : null;

      if (
        log.action === 'WORKER_PROMOTED' ||
        log.action === 'WORKER_REINSTATED'
      ) {
        sawWorkerPromotion = true;
      }

      events.push(
        this.toTimelineEvent(log.action as AuditAction, log.createdAt, {
          departmentName,
          clergyTitleName: metadata.clergyTitleName ?? null,
        }),
      );
    }

    // Fallback for workers whose promotion predates audit logging (legacy
    // data, bulk imports) — the worker_profiles row itself is the only
    // remaining signal that they became a worker at all.
    if (!sawWorkerPromotion && member.workerProfile) {
      events.push({
        type: MemberTimelineEventType.BECAME_WORKER,
        title: 'Became a Worker',
        description: member.workerProfile.department?.name ?? null,
        occurredAt: member.workerProfile.createdAt.toISOString(),
      });
    }

    return events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }

  private toTimelineEvent(
    action: AuditAction,
    occurredAt: Date,
    context: { departmentName: string | null; clergyTitleName: string | null },
  ): MemberTimelineEvent {
    const occurredAtIso = occurredAt.toISOString();
    switch (action) {
      case 'WORKER_PROMOTED':
        return {
          type: MemberTimelineEventType.BECAME_WORKER,
          title: 'Became a Worker',
          description: context.departmentName,
          occurredAt: occurredAtIso,
        };
      case 'WORKER_REINSTATED':
        return {
          type: MemberTimelineEventType.WORKER_STATUS_CHANGED,
          title: 'Reinstated as Worker',
          description: context.departmentName,
          occurredAt: occurredAtIso,
        };
      case 'WORKER_REVOKED':
        return {
          type: MemberTimelineEventType.WORKER_STATUS_CHANGED,
          title: 'Worker Access Revoked',
          description: null,
          occurredAt: occurredAtIso,
        };
      case 'WORKER_TRAINEE_DEMOTED':
        return {
          type: MemberTimelineEventType.WORKER_STATUS_CHANGED,
          title: 'Moved Back to Trainee',
          description: context.departmentName,
          occurredAt: occurredAtIso,
        };
      case 'CLERGY_ASSIGNED':
        return {
          type: MemberTimelineEventType.CLERGY,
          title: context.clergyTitleName
            ? `Ordained as ${context.clergyTitleName}`
            : 'Ordained',
          description: null,
          occurredAt: occurredAtIso,
        };
      case 'CLERGY_TITLE_CHANGED':
        return {
          type: MemberTimelineEventType.CLERGY,
          title: context.clergyTitleName
            ? `Clergy Title Changed to ${context.clergyTitleName}`
            : 'Clergy Title Changed',
          description: null,
          occurredAt: occurredAtIso,
        };
      case 'CLERGY_REMOVED':
        return {
          type: MemberTimelineEventType.CLERGY,
          title: 'Clergy Status Removed',
          description: null,
          occurredAt: occurredAtIso,
        };
      case 'MEMBER_ACTIVATED':
        return {
          type: MemberTimelineEventType.MEMBER_STATUS_CHANGED,
          title: 'Reactivated',
          description: null,
          occurredAt: occurredAtIso,
        };
      case 'MEMBER_DEACTIVATED':
        return {
          type: MemberTimelineEventType.MEMBER_STATUS_CHANGED,
          title: 'Deactivated',
          description: null,
          occurredAt: occurredAtIso,
        };
      default:
        return {
          type: MemberTimelineEventType.MILESTONE,
          title: action,
          description: null,
          occurredAt: occurredAtIso,
        };
    }
  }
}
