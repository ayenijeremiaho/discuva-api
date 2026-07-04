import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PrayerMeeting } from '../entity/prayer-meeting.entity';
import { PrayerRosterEntry } from '../entity/prayer-roster-entry.entity';
import { PrayerScheduleRule } from '../entity/prayer-schedule-rule.entity';
import { PrayerProgram } from '../entity/prayer-program.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { Member } from '../../member/entity/member.entity';
import { DepartmentLead } from '../../department/entity/department-lead.entity';
import {
  PrayerAssignmentType,
  PrayerAudience,
  PrayerMeetingStatus,
  PrayerRosterStatus,
  PrayerRuleType,
} from '../enum/prayer.enum';
import { ManualAssignDto, ReschedulePrayerEntryDto } from '../dto/prayer.dto';
import { WorkerStatusEnum } from '../../member/enums/worker-status.enum';
import { DepartmentLeadTypeEnum } from '../../department/enums/department-lead-type.enum';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';

interface AssignContext {
  meetings: PrayerMeeting[];
  existingEntries: PrayerRosterEntry[];
  leadMap: Map<string, DepartmentLeadTypeEnum>;
  assignedCount: Map<string, number>;
  capacities: Map<string, number>;
  leaderCounts: Map<string, number>;
  newEntries: Partial<PrayerRosterEntry>[];
  maxPerMeeting: number;
  frequencyRules: PrayerScheduleRule[];
  defaultFrequency: number;
}

@Injectable()
export class PrayerRosterService {
  constructor(
    @InjectRepository(PrayerMeeting)
    private readonly meetingRepo: Repository<PrayerMeeting>,
    @InjectRepository(PrayerRosterEntry)
    private readonly rosterRepo: Repository<PrayerRosterEntry>,
    @InjectRepository(PrayerScheduleRule)
    private readonly ruleRepo: Repository<PrayerScheduleRule>,
    @InjectRepository(PrayerProgram)
    private readonly programRepo: Repository<PrayerProgram>,
    @InjectRepository(WorkerProfile)
    private readonly workerRepo: Repository<WorkerProfile>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    @InjectRepository(DepartmentLead)
    private readonly deptLeadRepo: Repository<DepartmentLead>,
    private readonly pushService: PushNotificationService,
  ) {}

  async autoAssign(
    programId: string,
    month: number,
    year: number,
  ): Promise<{ assigned: number; unassignable: string[] }> {
    const program = await this.programRepo.findOne({
      where: { id: programId },
    });
    if (!program) throw new NotFoundException('Prayer program not found.');
    if (program.audience === PrayerAudience.MEMBERS) {
      throw new BadRequestException(
        'Auto-assign is not available for member-only programs. Use manual assignment or let members self-select.',
      );
    }

    const meetings = await this.meetingRepo.find({
      where: {
        month,
        year,
        status: PrayerMeetingStatus.SCHEDULED,
        program: { id: programId },
      },
      relations: ['dayConfig', 'rosterEntries', 'rosterEntries.workerProfile'],
      order: { date: 'ASC' },
    });
    if (!meetings.length)
      throw new NotFoundException(
        `No scheduled meetings found for ${year}-${month} in this program.`,
      );

    // Delete existing AUTO_ASSIGNED entries to make this call idempotent.
    // FIXED and SELF_SELECTED entries are preserved.
    const existingAutoIds = await this.rosterRepo.find({
      where: {
        meeting: { month, year, program: { id: programId } as any },
        assignmentType: PrayerAssignmentType.AUTO_ASSIGNED,
        status: PrayerRosterStatus.SCHEDULED,
      },
      select: ['id'],
    });
    if (existingAutoIds.length) {
      const ids = existingAutoIds.map((e) => e.id);
      await this.rosterRepo.delete(ids);
      // Reset capacities to reflect only fixed/self-selected entries
      for (const meeting of meetings) {
        const nonAutoCount = meeting.rosterEntries.filter(
          (e) => e.assignmentType !== PrayerAssignmentType.AUTO_ASSIGNED,
        ).length;
        if (meeting.currentCapacity !== nonAutoCount) {
          meeting.currentCapacity = nonAutoCount;
        }
      }
      await this.meetingRepo.save(meetings);
    }

    const { maxPerMeeting, minLeaders, frequencyRules, defaultFrequency } =
      await this.loadRules(programId);

    const activeWorkers = await this.workerRepo.find({
      where: { status: WorkerStatusEnum.ACTIVE },
    });
    const leadMap = await this.buildLeadMap();

    const existingEntries = await this.rosterRepo.find({
      where: {
        meeting: { month, year, program: { id: programId } as any },
        status: PrayerRosterStatus.SCHEDULED,
      },
      relations: ['workerProfile', 'meeting'],
    });

    const assignedCount = new Map<string, number>();
    for (const entry of existingEntries) {
      if (!entry.workerProfile) continue;
      const wid = entry.workerProfile.id;
      assignedCount.set(wid, (assignedCount.get(wid) ?? 0) + 1);
    }

    // Re-fetch meetings with updated capacities
    const freshMeetings = await this.meetingRepo.find({
      where: {
        month,
        year,
        status: PrayerMeetingStatus.SCHEDULED,
        program: { id: programId },
      },
      relations: ['dayConfig'],
      order: { date: 'ASC' },
    });

    const capacities = new Map(
      freshMeetings.map((m) => [m.id, m.currentCapacity]),
    );
    const leaderCounts = new Map<string, number>();
    for (const entry of existingEntries) {
      const mid = entry.meeting.id;
      if (entry.workerProfile && leadMap.has(entry.workerProfile.id)) {
        leaderCounts.set(mid, (leaderCounts.get(mid) ?? 0) + 1);
      }
    }

    const ctx: AssignContext = {
      meetings: freshMeetings,
      existingEntries,
      leadMap,
      assignedCount,
      capacities,
      leaderCounts,
      newEntries: [],
      maxPerMeeting,
      frequencyRules,
      defaultFrequency,
    };
    const unassignable: string[] = [];

    const unassigned = activeWorkers.filter(
      (w) => (assignedCount.get(w.id) ?? 0) < this.resolveFrequency(w.id, ctx),
    );
    const leaderWorkers = unassigned.filter((w) => leadMap.has(w.id));
    const regularWorkers = unassigned.filter((w) => !leadMap.has(w.id));

    for (const leader of leaderWorkers) {
      if (!this.tryAssignWorker(leader, ctx)) unassignable.push(leader.id);
    }

    this.checkLeaderGaps(ctx, minLeaders, unassignable);

    for (const worker of regularWorkers) {
      if (!this.tryAssignWorker(worker, ctx)) unassignable.push(worker.id);
    }

    if (ctx.newEntries.length) {
      await this.rosterRepo.save(ctx.newEntries as PrayerRosterEntry[]);
      const capacityUpdates = freshMeetings
        .filter(
          (m) =>
            (ctx.capacities.get(m.id) ?? m.currentCapacity) !==
            m.currentCapacity,
        )
        .map((m) => ({
          id: m.id,
          currentCapacity: ctx.capacities.get(m.id) as number,
        }));
      if (capacityUpdates.length) {
        await this.meetingRepo.save(capacityUpdates as PrayerMeeting[]);
      }
    }

    if (ctx.newEntries.length) {
      const assignedWorkerIds = [
        ...new Set(
          ctx.newEntries
            .filter((e) => e.workerProfile)
            .map((e) => (e.workerProfile as WorkerProfile).id),
        ),
      ];
      this.pushService.dispatchToWorkerProfileIds(assignedWorkerIds, {
        idempotencyKey: `prayer-auto-assign:${programId}:${month}:${year}`,
        title: 'Prayer Schedule Updated',
        body: 'Your prayer schedule for the month has been set.',
        url: '/prayer',
      });
    }

    return { assigned: ctx.newEntries.length, unassignable };
  }

  async manualAssign(
    programId: string,
    dto: ManualAssignDto,
  ): Promise<PrayerRosterEntry> {
    if (!dto.workerProfileId && !dto.memberId) {
      throw new BadRequestException(
        'Either workerProfileId or memberId must be provided.',
      );
    }

    const meeting = await this.meetingRepo.findOne({
      where: { id: dto.meetingId, program: { id: programId } },
      relations: ['dayConfig', 'program'],
    });
    if (!meeting)
      throw new NotFoundException('Meeting not found in this program.');
    if (meeting.currentCapacity >= meeting.dayConfig.maxCapacity) {
      throw new BadRequestException('This meeting is at full capacity.');
    }

    let workerProfile: WorkerProfile | null = null;
    let member: Member | null = null;

    if (dto.workerProfileId) {
      if (meeting.program.audience === PrayerAudience.MEMBERS) {
        throw new BadRequestException(
          'This program is for members only. Use memberId instead.',
        );
      }
      workerProfile = await this.workerRepo.findOne({
        where: { id: dto.workerProfileId },
      });
      if (!workerProfile)
        throw new NotFoundException('Worker profile not found.');

      const existing = await this.rosterRepo.findOne({
        where: {
          workerProfile: { id: dto.workerProfileId },
          meeting: { id: dto.meetingId },
          status: PrayerRosterStatus.SCHEDULED,
        },
      });
      if (existing)
        throw new ConflictException(
          'Worker is already assigned to this meeting.',
        );
    }

    if (dto.memberId) {
      if (meeting.program.audience === PrayerAudience.WORKERS) {
        throw new BadRequestException(
          'This program is for workers only. Use workerProfileId instead.',
        );
      }
      member = await this.memberRepo.findOne({ where: { id: dto.memberId } });
      if (!member) throw new NotFoundException('Member not found.');

      const existing = await this.rosterRepo.findOne({
        where: {
          member: { id: dto.memberId },
          meeting: { id: dto.meetingId },
          status: PrayerRosterStatus.SCHEDULED,
        },
      });
      if (existing)
        throw new ConflictException(
          'Member is already assigned to this meeting.',
        );
    }

    const entry = await this.rosterRepo.save(
      this.rosterRepo.create({
        workerProfile,
        member,
        meeting,
        assignmentType: PrayerAssignmentType.MANUAL,
      }),
    );

    meeting.currentCapacity += 1;
    await this.meetingRepo.save(meeting);

    if (workerProfile) {
      this.pushService.dispatchToWorkerProfileIds([workerProfile.id], {
        idempotencyKey: `prayer-manual-assign:${entry.id}`,
        title: 'Prayer Assignment',
        body: `You have been assigned to a prayer meeting on ${meeting.date}.`,
        url: '/prayer',
      });
    } else if (member) {
      this.pushService.dispatchToMemberIds([member.id], {
        idempotencyKey: `prayer-manual-assign:${entry.id}`,
        title: 'Prayer Assignment',
        body: `You have been assigned to a prayer meeting on ${meeting.date}.`,
        url: '/prayer',
      });
    }

    return entry;
  }

  async removeEntry(entryId: string): Promise<void> {
    const entry = await this.rosterRepo.findOne({
      where: { id: entryId },
      relations: ['meeting', 'workerProfile', 'member'],
    });
    if (!entry) throw new NotFoundException('Roster entry not found.');
    if (entry.assignmentType === PrayerAssignmentType.FIXED) {
      throw new BadRequestException(
        'Fixed assignments cannot be removed from the roster. Remove the fixed assignment configuration instead.',
      );
    }
    if (entry.status !== PrayerRosterStatus.SCHEDULED) {
      throw new BadRequestException('Only scheduled entries can be removed.');
    }

    await this.rosterRepo.delete(entryId);

    const meeting = await this.meetingRepo.findOne({
      where: { id: entry.meeting.id },
    });
    if (meeting && meeting.currentCapacity > 0) {
      meeting.currentCapacity -= 1;
      await this.meetingRepo.save(meeting);
    }

    if (entry.workerProfile) {
      this.pushService.dispatchToWorkerProfileIds([entry.workerProfile.id], {
        idempotencyKey: `prayer-removed:${entryId}`,
        title: 'Prayer Assignment Removed',
        body: 'Your prayer assignment has been removed.',
        url: '/prayer',
      });
    } else if (entry.member) {
      this.pushService.dispatchToMemberIds([entry.member.id], {
        idempotencyKey: `prayer-removed:${entryId}`,
        title: 'Prayer Assignment Removed',
        body: 'Your prayer assignment has been removed.',
        url: '/prayer',
      });
    }
  }

  async reschedule(
    entryId: string,
    dto: ReschedulePrayerEntryDto,
  ): Promise<PrayerRosterEntry> {
    const entry = await this.rosterRepo.findOne({
      where: { id: entryId },
      relations: ['workerProfile', 'member', 'meeting', 'meeting.dayConfig'],
    });
    if (!entry) throw new NotFoundException('Roster entry not found.');

    const newMeeting = await this.meetingRepo.findOne({
      where: { id: dto.newMeetingId },
      relations: ['dayConfig'],
    });
    if (!newMeeting)
      throw new NotFoundException('Target prayer meeting not found.');
    if (newMeeting.status !== PrayerMeetingStatus.SCHEDULED) {
      throw new BadRequestException(
        'Cannot reschedule to a meeting that is not in scheduled status.',
      );
    }
    if (newMeeting.currentCapacity >= newMeeting.dayConfig.maxCapacity) {
      throw new BadRequestException(
        'The target prayer meeting is fully booked.',
      );
    }

    if (entry.status !== PrayerRosterStatus.SCHEDULED) {
      throw new BadRequestException(
        'Only scheduled entries can be rescheduled.',
      );
    }

    if (entry.workerProfile) {
      const alreadyOnNewMeeting = await this.rosterRepo.findOne({
        where: {
          workerProfile: { id: entry.workerProfile.id },
          meeting: { id: dto.newMeetingId },
          status: PrayerRosterStatus.SCHEDULED,
        },
      });
      if (alreadyOnNewMeeting) {
        throw new BadRequestException(
          'This worker is already assigned to the target meeting.',
        );
      }
    }

    if (entry.member) {
      const alreadyOnNewMeeting = await this.rosterRepo.findOne({
        where: {
          member: { id: entry.member.id },
          meeting: { id: dto.newMeetingId },
          status: PrayerRosterStatus.SCHEDULED,
        },
      });
      if (alreadyOnNewMeeting) {
        throw new BadRequestException(
          'This member is already assigned to the target meeting.',
        );
      }
    }

    const newEntry = this.rosterRepo.create({
      workerProfile: entry.workerProfile,
      member: entry.member,
      meeting: newMeeting,
      assignmentType: entry.assignmentType,
      rescheduledFrom: entry,
      reminderTwoDaySent: false,
      reminderDaySent: false,
    });
    const saved = await this.rosterRepo.save(newEntry);

    entry.status = PrayerRosterStatus.RESCHEDULED;
    await this.rosterRepo.save(entry);
    newMeeting.currentCapacity += 1;
    await this.meetingRepo.save(newMeeting);

    const oldMeeting = await this.meetingRepo.findOne({
      where: { id: entry.meeting.id },
    });
    if (oldMeeting && oldMeeting.currentCapacity > 0) {
      oldMeeting.currentCapacity -= 1;
      await this.meetingRepo.save(oldMeeting);
    }

    if (entry.workerProfile) {
      this.pushService.dispatchToWorkerProfileIds([entry.workerProfile.id], {
        idempotencyKey: `prayer-reschedule:${saved.id}`,
        title: 'Prayer Rescheduled',
        body: `Your prayer meeting has been rescheduled to ${newMeeting.date}.`,
        url: '/prayer',
      });
    } else if (entry.member) {
      this.pushService.dispatchToMemberIds([entry.member.id], {
        idempotencyKey: `prayer-reschedule:${saved.id}`,
        title: 'Prayer Rescheduled',
        body: `Your prayer meeting has been rescheduled to ${newMeeting.date}.`,
        url: '/prayer',
      });
    }

    return saved;
  }

  async validateRoster(
    programId: string,
    month: number,
    year: number,
  ): Promise<{ valid: boolean; issues: string[] }> {
    const { minLeaders, frequencyRules, defaultFrequency } =
      await this.loadRules(programId);

    const activeWorkers = await this.workerRepo.find({
      where: { status: WorkerStatusEnum.ACTIVE },
    });
    const leadMap = await this.buildLeadMap();

    const entries = await this.rosterRepo.find({
      where: {
        meeting: { month, year, program: { id: programId } as any },
        status: PrayerRosterStatus.SCHEDULED,
      },
      relations: ['workerProfile', 'meeting'],
    });

    const meetings = await this.meetingRepo
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.rosterEntries', 're', 're.status = :status', {
        status: PrayerRosterStatus.SCHEDULED,
      })
      .leftJoinAndSelect('re.workerProfile', 'wp')
      .where('m.month = :month AND m.year = :year', { month, year })
      .andWhere('m.program_id = :programId', { programId })
      .getMany();

    const issues: string[] = [];

    for (const worker of activeWorkers) {
      const required = this.resolveFrequency(worker.id, {
        leadMap,
        frequencyRules,
        defaultFrequency,
      });
      const assigned = entries.filter(
        (e) => e.workerProfile?.id === worker.id,
      ).length;
      if (assigned !== required) {
        issues.push(
          `Worker ${worker.id} has ${assigned} assignment(s) but requires exactly ${required}.`,
        );
      }
    }

    for (const meeting of meetings) {
      const leaderCount = meeting.rosterEntries.filter(
        (e) => e.workerProfile && leadMap.has(e.workerProfile.id),
      ).length;
      if (leaderCount < minLeaders) {
        issues.push(
          `Meeting on ${meeting.date} has ${leaderCount} leader(s) but requires at least ${minLeaders}.`,
        );
      }
    }

    return { valid: issues.length === 0, issues };
  }

  private async loadRules(programId: string): Promise<{
    maxPerMeeting: number;
    minLeaders: number;
    frequencyRules: PrayerScheduleRule[];
    defaultFrequency: number;
  }> {
    const rules = await this.ruleRepo.find({
      where: { isActive: true, program: { id: programId } },
    });
    const maxPerMeeting =
      rules.find((r) => r.type === PrayerRuleType.MAX_PER_MEETING)?.value ??
      Infinity;
    const minLeaders =
      rules.find((r) => r.type === PrayerRuleType.MIN_LEADERS_PER_MEETING)
        ?.value ?? 1;
    const frequencyRules = rules.filter(
      (r) => r.type === PrayerRuleType.ROLE_FREQUENCY,
    );
    const defaultFrequency =
      frequencyRules.find((r) => r.targetLeadType === null)?.value ?? 1;
    return { maxPerMeeting, minLeaders, frequencyRules, defaultFrequency };
  }

  private async buildLeadMap(): Promise<Map<string, DepartmentLeadTypeEnum>> {
    const allLeads = await this.deptLeadRepo.find({
      relations: ['workerProfile'],
    });
    return new Map(allLeads.map((l) => [l.workerProfile.id, l.leadType]));
  }

  private resolveFrequency(
    workerId: string,
    ctx: Pick<AssignContext, 'leadMap' | 'frequencyRules' | 'defaultFrequency'>,
  ): number {
    const leadType = ctx.leadMap.get(workerId);
    if (leadType) {
      const rule = ctx.frequencyRules.find(
        (r) => r.targetLeadType === leadType,
      );
      if (rule) return rule.value;
    }
    return ctx.defaultFrequency;
  }

  private tryAssignWorker(worker: WorkerProfile, ctx: AssignContext): boolean {
    const required = this.resolveFrequency(worker.id, ctx);
    const alreadyAssigned = ctx.assignedCount.get(worker.id) ?? 0;
    const slotsNeeded = required - alreadyAssigned;

    const alreadyAssignedMeetingIds = new Set(
      ctx.existingEntries
        .filter((e) => e.workerProfile?.id === worker.id)
        .map((e) => e.meeting.id),
    );

    let slotsAssigned = 0;
    const availableMeetings = [...ctx.meetings].sort(
      (a, b) =>
        (ctx.capacities.get(a.id) ?? 0) - (ctx.capacities.get(b.id) ?? 0),
    );

    for (const meeting of availableMeetings) {
      if (slotsAssigned >= slotsNeeded) break;
      if (alreadyAssignedMeetingIds.has(meeting.id)) continue;
      const cap = ctx.capacities.get(meeting.id) ?? 0;
      if (cap >= Math.min(ctx.maxPerMeeting, meeting.dayConfig.maxCapacity))
        continue;

      ctx.newEntries.push({
        workerProfile: worker,
        meeting,
        assignmentType: PrayerAssignmentType.AUTO_ASSIGNED,
      });
      ctx.capacities.set(meeting.id, cap + 1);
      if (ctx.leadMap.has(worker.id)) {
        ctx.leaderCounts.set(
          meeting.id,
          (ctx.leaderCounts.get(meeting.id) ?? 0) + 1,
        );
      }
      alreadyAssignedMeetingIds.add(meeting.id);
      slotsAssigned++;
    }

    return slotsAssigned === slotsNeeded;
  }

  private checkLeaderGaps(
    ctx: AssignContext,
    minLeaders: number,
    unassignable: string[],
  ): void {
    const meetingsNeedingLeader = ctx.meetings.filter(
      (m) =>
        (ctx.leaderCounts.get(m.id) ?? 0) < minLeaders &&
        (ctx.capacities.get(m.id) ?? 0) < m.dayConfig.maxCapacity,
    );
    const leadTypes = new Set([
      DepartmentLeadTypeEnum.HOD,
      DepartmentLeadTypeEnum.D_HOD,
    ]);
    for (const meeting of meetingsNeedingLeader) {
      if ((ctx.leaderCounts.get(meeting.id) ?? 0) >= minLeaders) continue;
      const hasLeader = ctx.newEntries.some((e) => {
        if (e.meeting?.id !== meeting.id || !e.workerProfile) return false;
        const lt = ctx.leadMap.get(e.workerProfile.id);
        return lt !== undefined && leadTypes.has(lt);
      });
      if (!hasLeader) unassignable.push(`meeting:${meeting.id}:needs-leader`);
    }
  }
}
