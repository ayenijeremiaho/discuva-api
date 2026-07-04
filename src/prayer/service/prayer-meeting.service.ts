import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PrayerMeeting } from '../entity/prayer-meeting.entity';
import { PrayerRosterEntry } from '../entity/prayer-roster-entry.entity';
import { PrayerFixedAssignment } from '../entity/prayer-fixed-assignment.entity';
import { PrayerDayConfig } from '../entity/prayer-day-config.entity';
import { PrayerProgram } from '../entity/prayer-program.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { DepartmentLead } from '../../department/entity/department-lead.entity';
import { PrayerScheduleRule } from '../entity/prayer-schedule-rule.entity';
import {
  PrayerAssignmentType,
  PrayerAudience,
  PrayerMeetingStatus,
  PrayerRosterStatus,
  PrayerRuleType,
  PrayerWindowStatus,
} from '../enum/prayer.enum';
import {
  GenerateMonthlyMeetingsDto,
  OpenSelectionWindowDto,
  SelfSelectPrayerSlotDto,
} from '../dto/prayer.dto';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { WorkerStatusEnum } from '../../member/enums/worker-status.enum';

@Injectable()
export class PrayerMeetingService {
  constructor(
    @InjectRepository(PrayerMeeting)
    private readonly meetingRepo: Repository<PrayerMeeting>,
    @InjectRepository(PrayerRosterEntry)
    private readonly rosterRepo: Repository<PrayerRosterEntry>,
    @InjectRepository(PrayerFixedAssignment)
    private readonly fixedRepo: Repository<PrayerFixedAssignment>,
    @InjectRepository(PrayerDayConfig)
    private readonly dayConfigRepo: Repository<PrayerDayConfig>,
    @InjectRepository(PrayerProgram)
    private readonly programRepo: Repository<PrayerProgram>,
    @InjectRepository(WorkerProfile)
    private readonly workerRepo: Repository<WorkerProfile>,
    @InjectRepository(DepartmentLead)
    private readonly deptLeadRepo: Repository<DepartmentLead>,
    @InjectRepository(PrayerScheduleRule)
    private readonly ruleRepo: Repository<PrayerScheduleRule>,
    private readonly dataSource: DataSource,
    private readonly pushService: PushNotificationService,
  ) {}

  async generateMonthlyMeetings(
    programId: string,
    dto: GenerateMonthlyMeetingsDto,
  ): Promise<PrayerMeeting[]> {
    const program = await this.programRepo.findOne({
      where: { id: programId },
    });
    if (!program) throw new NotFoundException('Prayer program not found.');

    const existing = await this.meetingRepo.findOne({
      where: { month: dto.month, year: dto.year, program: { id: programId } },
    });
    if (existing)
      throw new ConflictException(
        `Prayer meetings for ${dto.year}-${dto.month} already exist for this program.`,
      );

    const dayConfigs = await this.dayConfigRepo.find({
      where: { isActive: true, program: { id: programId } },
    });
    if (!dayConfigs.length)
      throw new BadRequestException(
        'No active prayer day configs found for this program. Configure prayer days first.',
      );

    const dayConfigMap = new Map(dayConfigs.map((d) => [d.dayOfWeek, d]));
    const daysInMonth = new Date(dto.year, dto.month, 0).getDate();
    const meetings: PrayerMeeting[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(dto.year, dto.month - 1, day);
      const dayOfWeek = date.getDay();
      const config = dayConfigMap.get(dayOfWeek);
      if (!config) continue;

      const dateStr = `${dto.year}-${String(dto.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      meetings.push(
        this.meetingRepo.create({
          date: dateStr,
          month: dto.month,
          year: dto.year,
          program,
          dayConfig: config,
          status: PrayerMeetingStatus.SCHEDULED,
          selectionStatus: PrayerWindowStatus.PENDING,
          currentCapacity: 0,
        }),
      );
    }

    const saved = await this.meetingRepo.save(meetings);
    await this.applyFixedAssignments(programId, saved);
    return this.meetingRepo.find({
      where: { month: dto.month, year: dto.year, program: { id: programId } },
      relations: ['dayConfig', 'rosterEntries'],
      order: { date: 'ASC' },
    });
  }

  async openSelectionWindow(
    programId: string,
    dto: OpenSelectionWindowDto,
  ): Promise<void> {
    const meetings = await this.meetingRepo.find({
      where: { month: dto.month, year: dto.year, program: { id: programId } },
    });
    if (!meetings.length)
      throw new NotFoundException(
        `No meetings found for ${dto.year}-${dto.month}. Generate them first.`,
      );

    await this.meetingRepo.update(
      {
        month: dto.month,
        year: dto.year,
        program: { id: programId } as any,
        selectionStatus: PrayerWindowStatus.PENDING,
      },
      { selectionStatus: PrayerWindowStatus.OPEN },
    );

    const workers = await this.workerRepo.find({
      where: { status: WorkerStatusEnum.ACTIVE },
      select: ['id'],
    });
    this.pushService.dispatchToWorkerProfileIds(
      workers.map((w) => w.id),
      {
        idempotencyKey: `prayer-window-open:${programId}:${dto.month}:${dto.year}`,
        title: 'Prayer Selection Open',
        body: 'You can now select your prayer slots for the upcoming month.',
        url: '/prayer',
      },
    );
  }

  async closeSelectionWindow(
    programId: string,
    dto: OpenSelectionWindowDto,
  ): Promise<void> {
    await this.meetingRepo.update(
      {
        month: dto.month,
        year: dto.year,
        program: { id: programId } as any,
        selectionStatus: PrayerWindowStatus.OPEN,
      },
      { selectionStatus: PrayerWindowStatus.CLOSED },
    );
  }

  async getAvailableMeetings(
    programId: string,
    month: number,
    year: number,
  ): Promise<PrayerMeeting[]> {
    return this.meetingRepo
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.dayConfig', 'dc')
      .where('m.month = :month AND m.year = :year', { month, year })
      .andWhere('m.program_id = :programId', { programId })
      .andWhere('m.selectionStatus = :open', { open: PrayerWindowStatus.OPEN })
      .andWhere('m.currentCapacity < dc.maxCapacity')
      .orderBy('m.date', 'ASC')
      .getMany();
  }

  async selfSelect(
    programId: string,
    workerProfileId: string,
    dto: SelfSelectPrayerSlotDto,
  ): Promise<PrayerRosterEntry> {
    const program = await this.programRepo.findOne({
      where: { id: programId },
    });
    if (!program) throw new NotFoundException('Prayer program not found.');
    if (program.audience === PrayerAudience.MEMBERS) {
      throw new BadRequestException(
        'This prayer program is for members only. Workers cannot self-select.',
      );
    }

    const workerProfile = await this.workerRepo.findOne({
      where: { id: workerProfileId },
    });
    if (!workerProfile)
      throw new NotFoundException('Worker profile not found.');

    return this.dataSource.transaction(async (manager) => {
      const meeting = await manager
        .getRepository(PrayerMeeting)
        .createQueryBuilder('m')
        .innerJoinAndSelect('m.dayConfig', 'dc')
        .innerJoinAndSelect('m.program', 'p')
        .where('m.id = :id', { id: dto.meetingId })
        .setLock('pessimistic_write')
        .getOne();
      if (!meeting) throw new NotFoundException('Prayer meeting not found.');
      if (meeting.program.id !== programId) {
        throw new BadRequestException(
          'Meeting does not belong to this program.',
        );
      }
      if (meeting.selectionStatus !== PrayerWindowStatus.OPEN) {
        throw new BadRequestException(
          'Selection window is not open for this meeting.',
        );
      }
      if (meeting.currentCapacity >= meeting.dayConfig.maxCapacity) {
        throw new BadRequestException('This prayer day is fully booked.');
      }

      const fixedOnThisDay = await manager.findOne(PrayerFixedAssignment, {
        where: {
          workerProfile: { id: workerProfileId },
          dayConfig: { id: meeting.dayConfig.id },
          isActive: true,
        },
      });
      if (fixedOnThisDay) {
        throw new BadRequestException(
          'You already have a fixed assignment for this prayer day. Contact an admin to make changes.',
        );
      }

      const requiredFrequency = await this.getRequiredFrequency(
        programId,
        workerProfileId,
      );
      const existingCount = await manager.count(PrayerRosterEntry, {
        where: {
          workerProfile: { id: workerProfileId },
          meeting: {
            month: meeting.month,
            year: meeting.year,
            program: { id: programId } as any,
          },
          status: PrayerRosterStatus.SCHEDULED,
        },
      });
      if (existingCount >= requiredFrequency) {
        throw new BadRequestException(
          `You have already selected your required ${requiredFrequency} prayer slot(s) for this month.`,
        );
      }

      const alreadyOnThisDay = await manager.findOne(PrayerRosterEntry, {
        where: {
          workerProfile: { id: workerProfileId },
          meeting: { id: dto.meetingId },
          status: PrayerRosterStatus.SCHEDULED,
        },
      });
      if (alreadyOnThisDay)
        throw new ConflictException(
          'You are already assigned to this prayer meeting.',
        );

      const entry = manager.create(PrayerRosterEntry, {
        workerProfile,
        meeting,
        assignmentType: PrayerAssignmentType.SELF_SELECTED,
      });
      const saved = await manager.save(PrayerRosterEntry, entry);

      meeting.currentCapacity += 1;
      if (meeting.currentCapacity >= meeting.dayConfig.maxCapacity) {
        meeting.selectionStatus = PrayerWindowStatus.CLOSED;
      }
      await manager.save(PrayerMeeting, meeting);

      return saved;
    });
  }

  async getMyRoster(
    workerProfileId: string,
    programId: string,
    month: number,
    year: number,
  ): Promise<PrayerRosterEntry[]> {
    return this.rosterRepo.find({
      where: {
        workerProfile: { id: workerProfileId },
        meeting: { month, year, program: { id: programId } as any },
        status: PrayerRosterStatus.SCHEDULED,
      },
      relations: ['meeting', 'meeting.dayConfig'],
      order: { meeting: { date: 'ASC' } },
    });
  }

  async getMonthlyRoster(
    programId: string,
    month: number,
    year: number,
  ): Promise<PrayerMeeting[]> {
    return this.meetingRepo
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.dayConfig', 'dc')
      .leftJoinAndSelect('m.program', 'p')
      .leftJoinAndSelect('m.rosterEntries', 're', 're.status = :status', {
        status: PrayerRosterStatus.SCHEDULED,
      })
      .leftJoinAndSelect('re.workerProfile', 'wp')
      .leftJoinAndSelect('wp.member', 'wpmem')
      .leftJoinAndSelect('re.member', 'mem')
      .where('m.month = :month AND m.year = :year', { month, year })
      .andWhere('m.program_id = :programId', { programId })
      .orderBy('m.date', 'ASC')
      .getMany();
  }

  async getSelectionStatus(
    programId: string,
    workerProfileId: string,
    month: number,
    year: number,
  ): Promise<{
    required: number;
    selected: number;
    canSubmit: boolean;
    entries: PrayerRosterEntry[];
  }> {
    const required = await this.getRequiredFrequency(
      programId,
      workerProfileId,
    );
    const entries = await this.rosterRepo.find({
      where: {
        workerProfile: { id: workerProfileId },
        meeting: { month, year, program: { id: programId } as any },
        status: PrayerRosterStatus.SCHEDULED,
      },
      relations: ['meeting', 'meeting.dayConfig'],
    });
    const selected = entries.length;
    return { required, selected, canSubmit: selected === required, entries };
  }

  private async applyFixedAssignments(
    programId: string,
    meetings: PrayerMeeting[],
  ): Promise<void> {
    const dayConfigIds = [...new Set(meetings.map((m) => m.dayConfig.id))];
    if (!dayConfigIds.length) return;

    const fixedAssignments = await this.fixedRepo.find({
      where: { isActive: true, dayConfig: { program: { id: programId } } },
      relations: ['workerProfile', 'dayConfig'],
    });
    if (!fixedAssignments.length) return;

    const entries: PrayerRosterEntry[] = [];
    for (const fixed of fixedAssignments) {
      const matchingMeetings = meetings.filter(
        (m) => m.dayConfig.id === fixed.dayConfig.id,
      );
      for (const meeting of matchingMeetings) {
        if (meeting.currentCapacity >= meeting.dayConfig.maxCapacity) continue;
        entries.push(
          this.rosterRepo.create({
            workerProfile: fixed.workerProfile,
            meeting,
            assignmentType: PrayerAssignmentType.FIXED,
          }),
        );
        meeting.currentCapacity += 1;
      }
    }

    if (entries.length) {
      await this.rosterRepo.save(entries);
      await this.meetingRepo.save(meetings);
    }
  }

  private async getRequiredFrequency(
    programId: string,
    workerProfileId: string,
  ): Promise<number> {
    const rules = await this.ruleRepo.find({
      where: {
        type: PrayerRuleType.ROLE_FREQUENCY,
        isActive: true,
        program: { id: programId },
      },
    });
    const lead = await this.deptLeadRepo.findOne({
      where: { workerProfile: { id: workerProfileId } },
    });

    if (lead) {
      const leadRule = rules.find((r) => r.targetLeadType === lead.leadType);
      if (leadRule) return leadRule.value;
    }

    const defaultRule = rules.find((r) => r.targetLeadType === null);
    return defaultRule?.value ?? 1;
  }
}
