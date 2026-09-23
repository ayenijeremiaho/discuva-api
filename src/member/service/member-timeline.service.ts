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
import { SundaySchoolAttendance } from '../../sunday-school/entity/sunday-school-attendance.entity';
import { SundaySchoolAttendanceStatus } from '../../sunday-school/enums/sunday-school-attendance-status.enum';
import { Attendance } from '../../attendance/entity/attendance.entity';
import { AttendanceStatusEnum } from '../../attendance/enums/check-in.enum';
import { ChildGuardian } from '../../children-church/entity/child-guardian.entity';
import { ChildCheckIn } from '../../children-church/entity/child-check-in.entity';

export interface MemberTimeline {
  events: MemberTimelineEvent[];
  // Regular-service attendance: first-timer FIRST_VISIT/REPEAT_VISIT entries
  // plus post-conversion Attendance rows with status PRESENT/LATE.
  serviceVisitCount: number;
  // Sunday School attendance only (status PRESENT), pre- and
  // post-conversion — kept separate from serviceVisitCount since the two
  // are different programs, not the same headcount.
  sundaySchoolVisitCount: number;
  // Current status, not a historical event — false for a non-worker.
  isTraineeNow: boolean;
  // Times this member dropped off or picked up a child at Children's Church
  // (as a ChildGuardian) — tracks the guardian's own engagement, not the
  // child's; a child has no Member/FirstTimer record of their own.
  childrenChurchDropOffs: number;
}

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
  'WORKER_TRAINEE_STATUS_CHANGED',
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
    @InjectRepository(SundaySchoolAttendance)
    private readonly sundaySchoolAttendanceRepo: Repository<SundaySchoolAttendance>,
    @InjectRepository(Attendance)
    private readonly attendanceRepo: Repository<Attendance>,
    @InjectRepository(ChildGuardian)
    private readonly childGuardianRepo: Repository<ChildGuardian>,
    @InjectRepository(ChildCheckIn)
    private readonly childCheckInRepo: Repository<ChildCheckIn>,
    private readonly auditLogService: AuditLogService,
    private readonly followUpService: FollowUpService,
  ) {}

  async getTimeline(memberId: string): Promise<MemberTimeline> {
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
        isTrainee?: boolean;
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
          isTrainee: metadata.isTrainee ?? null,
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

    // Sunday School check-ins are queried twice: first_timer_id
    // pre-conversion, member_id after — that row is never re-linked.
    const preConversionVisitCount = events.filter(
      (e) =>
        e.type === MemberTimelineEventType.FIRST_VISIT ||
        e.type === MemberTimelineEventType.REPEAT_VISIT,
    ).length;

    const [
      preConversionSundaySchoolRows,
      postConversionSundaySchoolRows,
      regularAttendanceCount,
    ] = await Promise.all([
      firstTimer
        ? this.sundaySchoolAttendanceRepo.find({
            where: {
              firstTimer: { id: firstTimer.id },
              status: SundaySchoolAttendanceStatus.PRESENT,
            },
            relations: ['session', 'session.sundaySchoolClass'],
          })
        : Promise.resolve([]),
      this.sundaySchoolAttendanceRepo.find({
        where: {
          member: { id: memberId },
          status: SundaySchoolAttendanceStatus.PRESENT,
        },
        relations: ['session', 'session.sundaySchoolClass'],
      }),
      this.attendanceRepo
        .createQueryBuilder('a')
        .where('a.member_id = :memberId', { memberId })
        .andWhere('a.status IN (:...statuses)', {
          statuses: [AttendanceStatusEnum.PRESENT, AttendanceStatusEnum.LATE],
        })
        .getCount(),
    ]);

    for (const row of [
      ...preConversionSundaySchoolRows,
      ...postConversionSundaySchoolRows,
    ]) {
      events.push({
        type: MemberTimelineEventType.SUNDAY_SCHOOL_VISIT,
        title: 'Attended Sunday School',
        description: row.session?.sundaySchoolClass?.name ?? null,
        occurredAt: new Date(
          row.session?.sessionDate ?? row.markedAt,
        ).toISOString(),
      });
    }

    const serviceVisitCount = preConversionVisitCount + regularAttendanceCount;
    const sundaySchoolVisitCount =
      preConversionSundaySchoolRows.length +
      postConversionSundaySchoolRows.length;

    const guardianRows = await this.childGuardianRepo.find({
      where: { member: { id: memberId } },
    });
    const childrenChurchDropOffs = guardianRows.length
      ? await this.childCheckInRepo
          .createQueryBuilder('cci')
          .where('cci.dropped_off_by_id IN (:...ids)', {
            ids: guardianRows.map((g) => g.id),
          })
          .orWhere('cci.picked_up_by_id IN (:...ids)', {
            ids: guardianRows.map((g) => g.id),
          })
          .getCount()
      : 0;

    return {
      events: events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
      serviceVisitCount,
      sundaySchoolVisitCount,
      isTraineeNow: member.workerProfile?.isTrainee ?? false,
      childrenChurchDropOffs,
    };
  }

  private toTimelineEvent(
    action: AuditAction,
    occurredAt: Date,
    context: {
      departmentName: string | null;
      clergyTitleName: string | null;
      isTrainee: boolean | null;
    },
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
      case 'WORKER_TRAINEE_STATUS_CHANGED':
        return {
          type: MemberTimelineEventType.TRAINEE_STATUS_CHANGED,
          title: context.isTrainee ? 'Started Training' : 'Completed Training',
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
