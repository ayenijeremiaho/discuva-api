import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, In, QueryFailedError, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Attendance } from '../entity/attendance.entity';
import { AttendanceSettingsService } from './attendance-settings.service';
import { AttendanceStatusEnum } from '../enums/check-in.enum';
import {
  FOLLOW_UP_QUEUE,
  POST_EVENT_JOB,
} from '../../follow-up/processor/post-event.processor';
import { CheckInDto } from '../dto/check-in.dto';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { WorkerStatusEnum } from '../../member/enums/worker-status.enum';
import { Member } from '../../member/entity/member.entity';
import { MemberService } from '../../member/service/member.service';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { Event } from '../../event/entity/event.entity';
import { EventService } from '../../event/service/event.service';
import { DepartmentService } from '../../department/service/department.service';
import { DepartmentAccessService } from '../../department/service/department-access.service';
import { UtilityService } from '../../utility/service/utility.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { DateService } from '../../utility/service/date.service';
import { CacheService } from '../../utility/service/cache.service';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { DepartmentCapability } from '../../department/enums/department-capability.enum';
import { ExcelService } from '../../utility/service/excel.service';
import { EmailQueueService } from '../../utility/service/email-queue.service';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { buildJobEnvelope } from '../../tenant/utility/job-envelope';
import { ExportAttendanceEmailDto } from '../dto/export-attendance-email.dto';
import { Admin } from '../../admin/entity/admin.entity';

const MAX_EXPORT_ROWS = 5000;

export interface DepartmentAttendanceSummary {
  departmentId: string;
  departmentName: string;
  totalWorkers: number;
  attendedWorkers: number;
  attendancePercentage: number;
}

export interface DepartmentEventAttendanceResult {
  eventId: string;
  eventName: string;
  slots: { slotId: string; slotName: string; startTime: Date }[];
  workers: {
    workerId: string;
    memberId: string;
    name: string;
    attendance: {
      slotId: string;
      status: AttendanceStatusEnum | null;
      checkinTime: Date | null;
    }[];
  }[];
}

export interface MyAttendanceSummary {
  totalCount: number;
  presentCount: number;
  attendanceRatePercentage: number;
  lastCheckedInDate: Date | null;
  attendanceStreak: number;
}

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);
  private readonly leaderboardTtl: number;
  private readonly productName: string;
  private readonly churchName: string;
  private readonly churchAddress: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly memberService: MemberService,
    private readonly eventService: EventService,
    private readonly departmentService: DepartmentService,
    private readonly departmentAccessService: DepartmentAccessService,
    private readonly configService: ConfigService,
    private readonly utilityService: UtilityService,
    private readonly dateService: DateService,
    private readonly cacheService: CacheService,
    @InjectQueue(FOLLOW_UP_QUEUE) private readonly followUpQueue: Queue,
    @InjectRepository(Attendance)
    private readonly attendanceRepository: Repository<Attendance>,
    @InjectRepository(ServiceSlot)
    private readonly slotRepository: Repository<ServiceSlot>,
    private readonly auditLogService: AuditLogService,
    private readonly excelService: ExcelService,
    private readonly emailQueueService: EmailQueueService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly attendanceSettingsService: AttendanceSettingsService,
  ) {
    this.leaderboardTtl = this.configService.get<number>(
      'CACHE_TTL_LEADERBOARD_SECONDS',
    );
    this.productName = this.configService.get<string>('PRODUCT_NAME');
    this.churchName = this.configService.get<string>('CHURCH_NAME');
    this.churchAddress = this.configService.get<string>('CHURCH_ADDRESS');
  }

  async checkin(
    user: MemberAuth,
    dto: CheckInDto,
  ): Promise<{ message: string }> {
    const [slot, member] = await Promise.all([
      this.getSlotOrThrow(dto.serviceSlotId),
      this.memberService.getById(user.id, ['workerProfile']),
    ]);

    this.assertMemberActive(member);

    const isWorker = member.role === MemberRoleEnum.WORKER;

    if (isWorker && !dto.location) {
      throw new BadRequestException(
        'Workers must provide their location to check in.',
      );
    }

    const existing = await this.alreadyCheckedIn(user.id, slot.event.id);
    if (existing) {
      const time = existing.checkinTime
        ? ` at ${this.dateService.format(existing.checkinTime, DateService.PATTERNS.EMAIL_TIME)}`
        : '';
      throw new BadRequestException(
        `You have already checked in for this service${time}.`,
      );
    }

    const cfg = this.eventService.resolveSlotConfig(slot);
    const now = this.dateService.now();

    this.validateCheckinWindow(now, slot, cfg, isWorker);

    if (dto.location) {
      await this.validateLocation(dto.location, cfg);
    }

    const status = this.resolveStatus(now, slot, cfg, isWorker);

    try {
      await this.attendanceRepository.save(
        this.attendanceRepository.create({
          member,
          event: slot.event,
          serviceSlot: slot,
          checkinTime: now,
          status,
          roleAtCheckin: member.role,
          location: dto.location ?? null,
        }),
      );
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as any).driverError?.code === '23505'
      ) {
        throw new ConflictException(
          'You have already checked in for this event.',
        );
      }
      throw err;
    }

    const firstName = UtilityService.capitalizeFirstLetter(member.firstname);
    const formattedStartTime = this.dateService.format(
      slot.startTime,
      DateService.PATTERNS.EMAIL_DATE,
    );
    const formattedSlotTime = this.dateService.format(
      slot.startTime,
      DateService.PATTERNS.EMAIL_TIME,
    );
    const formattedCheckinTime = this.dateService.format(
      now,
      DateService.PATTERNS.EMAIL_TIME,
    );

    this.utilityService.sendEmailWithTemplate(
      member.email,
      `${firstName}, ${this.productName} Check-in Confirmed`,
      'checkin-confirmation',
      {
        name: firstName,
        serviceName: slot.name,
        eventDate: formattedStartTime,
        slotTime: formattedSlotTime,
        checkinTime: formattedCheckinTime,
        status: status === AttendanceStatusEnum.LATE ? 'Late' : 'Present',
        churchName: this.churchName,
        churchAddress: this.churchAddress,
      },
      undefined,
      EmailCategory.ATTENDANCE_CHECKIN,
    );

    return { message: 'Check-in successful' };
  }

  // Called from AttendanceJobService's @Cron via forEachActiveTenant, which
  // has already entered this tenant's CLS/transaction context — deliberately
  // uses the ambient this.txHost.tx manager rather than opening its own
  // this.dataSource.transaction(...), which would start an independent
  // transaction (likely a different pooled connection) that never sees the
  // outer SET LOCAL search_path and would silently write to the wrong schema.
  async markAbsentees(): Promise<void> {
    this.logger.log('Running absence marking job...');

    const events = await this.eventService.findEventsReadyForAbsenceMarking();
    if (!events.length) {
      this.logger.log('No events pending absence marking');
      return;
    }

    this.logger.log(`Processing ${events.length} event(s) for absence marking`);

    const manager = this.txHost.tx;
    for (const event of events) {
      this.logger.log(`Processing event: ${event.name} (${event.id})`);

      const [absentMembers, absentWorkers] = await Promise.all([
        this.memberService.getMembersNotCheckedInForEvent(event.id),
        this.memberService.getWorkersNotCheckedInForEvent(event.id),
      ]);

      const records: Partial<Attendance>[] = [];

      for (const m of absentMembers) {
        records.push(
          this.buildAbsenceRecord(m, event, MemberRoleEnum.MEMBER, false),
        );
      }

      const onLeaveIds = await this.getBatchApprovedLeave(
        absentWorkers.map((w) => w.id),
        event,
      );
      for (const w of absentWorkers) {
        records.push(
          this.buildAbsenceRecord(
            w,
            event,
            MemberRoleEnum.WORKER,
            onLeaveIds.has(w.id),
          ),
        );
      }

      if (records.length > 0) {
        await manager.save(Attendance, records);
        this.logger.log(
          `Marked ${records.length} absence(s) for event "${event.name}"`,
        );
      }

      await manager.update(Event, event.id, { attendanceMarked: true });
      this.followUpQueue.add(
        POST_EVENT_JOB,
        { eventId: event.id, ...buildJobEnvelope(this.cls) },
        {
          attempts: 2,
          backoff: { type: 'fixed', delay: 5000 },
        },
      );
    }

    this.logger.log('Absence marking job complete');
  }

  async getMyHistory(
    user: MemberAuth,
    page = 1,
    limit = 10,
    status?: AttendanceStatusEnum,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<PaginationResponseDto<Attendance>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');

    const qb = this.attendanceRepository
      .createQueryBuilder('attendance')
      .leftJoinAndSelect('attendance.event', 'event')
      .leftJoinAndSelect('attendance.serviceSlot', 'slot')
      .where('attendance.member.id = :memberId', { memberId: user.id })
      .orderBy('attendance.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) qb.andWhere('attendance.status = :status', { status });
    if (dateFrom)
      qb.andWhere('attendance.checkinTime >= :dateFrom', {
        dateFrom: new Date(dateFrom),
      });
    if (dateTo)
      qb.andWhere('attendance.checkinTime <= :dateTo', {
        dateTo: new Date(dateTo),
      });

    const [data, total] = await qb.getManyAndCount();
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  private buildHistoryQb(
    memberId?: string,
    slotId?: string,
    status?: AttendanceStatusEnum,
    dateFrom?: string,
    dateTo?: string,
    search?: string,
  ) {
    const qb = this.attendanceRepository
      .createQueryBuilder('attendance')
      .leftJoinAndSelect('attendance.event', 'event')
      .leftJoinAndSelect('attendance.member', 'member')
      .leftJoinAndSelect('member.workerProfile', 'profile')
      .leftJoinAndSelect('profile.department', 'department')
      .leftJoinAndSelect('attendance.serviceSlot', 'slot')
      .orderBy('attendance.createdAt', 'DESC');

    if (memberId) qb.andWhere('member.id = :memberId', { memberId });
    if (slotId) qb.andWhere('slot.id = :slotId', { slotId });
    if (status) qb.andWhere('attendance.status = :status', { status });
    if (dateFrom)
      qb.andWhere('attendance.checkinTime >= :dateFrom', {
        dateFrom: new Date(dateFrom),
      });
    if (dateTo)
      qb.andWhere('attendance.checkinTime <= :dateTo', {
        dateTo: new Date(dateTo),
      });
    if (search)
      qb.andWhere(
        '(member.firstname ILIKE :search OR member.lastname ILIKE :search OR member.email ILIKE :search)',
        { search: `%${search}%` },
      );

    return qb;
  }

  async getAllHistory(
    page = 1,
    limit = 10,
    memberId?: string,
    slotId?: string,
    status?: AttendanceStatusEnum,
    dateFrom?: string,
    dateTo?: string,
    search?: string,
  ): Promise<PaginationResponseDto<Attendance>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');

    const [data, total] = await this.buildHistoryQb(
      memberId,
      slotId,
      status,
      dateFrom,
      dateTo,
      search,
    )
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async emailExportHistory(
    dto: ExportAttendanceEmailDto,
    admin: Admin,
  ): Promise<void> {
    const recipient = dto.recipientEmail ?? admin.member?.email;
    if (!recipient) {
      throw new BadRequestException(
        'No recipient email available — provide recipientEmail explicitly.',
      );
    }

    const records = await this.buildHistoryQb(
      dto.memberId,
      dto.slotId,
      dto.status,
      dto.dateFrom,
      dto.dateTo,
      dto.search,
    )
      .take(MAX_EXPORT_ROWS)
      .getMany();

    const rows = records.map((r) => ({
      member: `${r.member?.firstname ?? ''} ${r.member?.lastname ?? ''}`.trim(),
      department: r.member?.workerProfile?.department?.name ?? '',
      service: r.serviceSlot?.name ?? '',
      status: r.status,
      checkinTime: r.checkinTime ? r.checkinTime.toISOString() : '',
    }));

    const buffer = await this.excelService.buildWorkbook(
      'Attendance History',
      [
        { header: 'Member', key: 'member', width: 28 },
        { header: 'Department', key: 'department', width: 22 },
        { header: 'Service', key: 'service', width: 24 },
        { header: 'Status', key: 'status', width: 14 },
        { header: 'Check-in Time', key: 'checkinTime', width: 24 },
      ],
      rows,
    );

    const filterSummary = [
      dto.dateFrom ? `from ${dto.dateFrom}` : null,
      dto.dateTo ? `to ${dto.dateTo}` : null,
      dto.status ? `status ${dto.status}` : null,
    ]
      .filter(Boolean)
      .join(' ');

    await this.emailQueueService.queueEmailWithTemplateAndAttachments(
      recipient,
      'Your Attendance History Report',
      'report-export',
      {
        reportTitle: 'Attendance History',
        generatedAt: new Date().toLocaleString(),
        filterSummary: filterSummary || null,
      },
      [{ filename: 'attendance-history.xlsx', content: buffer }],
    );

    this.auditLogService.log('REPORT_EXPORTED', {
      actorId: admin.id,
      targetEmail: recipient,
      metadata: { report: 'attendance-history' },
    });
  }

  async getDepartmentHistory(
    user: MemberAuth,
    slotId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginationResponseDto<Attendance>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');

    const deptId = await this.departmentService.getDepartmentIdForLead(user.id);
    if (!deptId)
      throw new ForbiddenException(
        "You must be a department lead to view this department's attendance history.",
      );

    const [data, total] = await this.attendanceRepository
      .createQueryBuilder('attendance')
      .leftJoinAndSelect('attendance.event', 'event')
      .leftJoinAndSelect('attendance.member', 'member')
      .leftJoinAndSelect('member.workerProfile', 'profile')
      .leftJoin('profile.department', 'dept')
      .leftJoinAndSelect('attendance.serviceSlot', 'slot')
      .where('dept.id = :deptId', { deptId })
      .andWhere('slot.id = :slotId', { slotId })
      .orderBy('attendance.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async getDepartmentEventAttendance(
    user: MemberAuth,
    eventId: string,
  ): Promise<DepartmentEventAttendanceResult> {
    const deptId = await this.departmentService.getDepartmentIdForLead(user.id);
    if (!deptId)
      throw new ForbiddenException(
        "You must be a department lead to view this department's event attendance.",
      );

    const [slots, workers] = await Promise.all([
      this.slotRepository.find({
        where: { event: { id: eventId } },
        relations: ['event'],
        order: { startTime: 'ASC' },
      }),
      this.departmentService.getWorkersInDepartment(deptId),
    ]);

    if (!slots.length)
      throw new NotFoundException(
        'Event not found or it has no service slots.',
      );

    const memberIds = workers.map((w) => w.member.id);
    const slotIds = slots.map((s) => s.id);

    const records =
      memberIds.length > 0
        ? await this.attendanceRepository.find({
            where: {
              member: { id: In(memberIds) },
              serviceSlot: { id: In(slotIds) },
            },
            relations: ['member', 'serviceSlot'],
          })
        : [];

    const lookup = new Map<string, Attendance>();
    for (const r of records) {
      lookup.set(`${r.member.id}:${r.serviceSlot.id}`, r);
    }

    const event = slots[0].event;

    return {
      eventId,
      eventName: event?.name ?? '',
      slots: slots.map((s) => ({
        slotId: s.id,
        slotName: s.name,
        startTime: s.startTime,
      })),
      workers: workers.map((w) => ({
        workerId: w.id,
        memberId: w.member.id,
        name: `${w.member.firstname} ${w.member.lastname}`,
        attendance: slots.map((s) => {
          const rec = lookup.get(`${w.member.id}:${s.id}`);
          return {
            slotId: s.id,
            status: rec?.status ?? null,
            checkinTime: rec?.checkinTime ?? null,
          };
        }),
      })),
    };
  }

  async confirmOnlineAttendance(
    memberId: string,
    eventId: string,
  ): Promise<{ message: string }> {
    const event = await this.dataSource
      .getRepository(Event)
      .findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    if (!event.onlineAttendanceEnabled) {
      throw new BadRequestException(
        'Online attendance is not enabled for this event',
      );
    }

    const windowHours = this.configService.get<number>(
      'ONLINE_CHECKIN_WINDOW_HOURS',
    );
    if (!event.onlineNotificationSentAt) {
      throw new BadRequestException(
        'Online attendance window has not opened yet',
      );
    }
    const windowCloseTime = new Date(
      event.onlineNotificationSentAt.getTime() + windowHours * 60 * 60 * 1000,
    );
    if (new Date() > windowCloseTime) {
      throw new BadRequestException('The online attendance window has closed');
    }

    const record = await this.attendanceRepository.findOne({
      where: { member: { id: memberId }, event: { id: eventId } },
    });

    if (!record)
      throw new NotFoundException('No attendance record found for this event');
    if (record.status !== AttendanceStatusEnum.ABSENT) {
      throw new BadRequestException(
        'Your attendance for this event is already recorded',
      );
    }

    record.status = AttendanceStatusEnum.ATTENDED_ONLINE;
    await this.attendanceRepository.save(record);
    return { message: 'Online attendance confirmed' };
  }

  async getSlotSummary(
    slotId: string,
  ): Promise<Record<AttendanceStatusEnum, number>> {
    const rows = await this.attendanceRepository
      .createQueryBuilder('attendance')
      .select('attendance.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('attendance.serviceSlot.id = :slotId', { slotId })
      .groupBy('attendance.status')
      .getRawMany<{ status: AttendanceStatusEnum; count: string }>();

    const summary: Record<AttendanceStatusEnum, number> = {
      [AttendanceStatusEnum.PRESENT]: 0,
      [AttendanceStatusEnum.LATE]: 0,
      [AttendanceStatusEnum.ABSENT]: 0,
      [AttendanceStatusEnum.ON_LEAVE]: 0,
      [AttendanceStatusEnum.ATTENDED_ONLINE]: 0,
    };

    for (const row of rows) {
      summary[row.status] = Number.parseInt(row.count, 10);
    }
    return summary;
  }

  async getWorkerLeaderboard(daysAgo = 7, limit = 10): Promise<any[]> {
    const key = this.cacheService.key('leaderboard', `${daysAgo}:${limit}`);
    const cached = await this.cacheService.get<any[]>(key);
    if (cached) return cached;

    const since = this.dateService.daysAgo(daysAgo);

    const rows = await this.attendanceRepository
      .createQueryBuilder('attendance')
      .select('member.id', 'memberId')
      .addSelect('member.firstname', 'firstname')
      .addSelect('member.lastname', 'lastname')
      .addSelect('dept.name', 'departmentName')
      .addSelect(
        `SUM(CASE WHEN attendance.status IN ('PRESENT','LATE') THEN 1 ELSE 0 END)`,
        'presentCount',
      )
      .addSelect(
        `SUM(CASE WHEN attendance.status = 'ABSENT' THEN 1 ELSE 0 END)`,
        'absentCount',
      )
      .innerJoin('attendance.member', 'member')
      .innerJoin('member.workerProfile', 'profile')
      .innerJoin('profile.department', 'dept')
      .where('attendance.createdAt >= :since', { since })
      .andWhere('attendance.roleAtCheckin = :role', {
        role: MemberRoleEnum.WORKER,
      })
      .andWhere('profile.status = :wStatus', {
        wStatus: WorkerStatusEnum.ACTIVE,
      })
      .groupBy('member.id, member.firstname, member.lastname, dept.name')
      .orderBy('"presentCount"', 'DESC')
      .limit(limit)
      .getRawMany();

    const result = rows.map((r, i) => ({
      rank: i + 1,
      name: `${r.firstname} ${r.lastname}`,
      department: r.departmentName,
      presentCount: Number.parseInt(r.presentCount, 10),
      absentCount: Number.parseInt(r.absentCount, 10),
    }));
    this.cacheService.set(key, result, this.leaderboardTtl);
    return result;
  }

  async getPersonalAttendancePercentage(
    memberId: string,
    daysAgo = 30,
  ): Promise<number> {
    const since = this.dateService.daysAgo(daysAgo);

    const { total, attended } = await this.attendanceRepository
      .createQueryBuilder('attendance')
      .select('COUNT(*)', 'total')
      .addSelect(
        `SUM(CASE WHEN attendance.status IN ('PRESENT','LATE') THEN 1 ELSE 0 END)`,
        'attended',
      )
      .where('attendance.member_id = :memberId', { memberId })
      .andWhere('attendance.createdAt >= :since', { since })
      .getRawOne<{ total: string; attended: string }>();

    const t = Number.parseInt(total ?? '0', 10);
    const a = Number.parseInt(attended ?? '0', 10);
    return t === 0 ? 0 : Math.min(Number(((a / t) * 100).toFixed(2)), 100);
  }

  async getWorkerAttendancePercentage(
    daysAgo = 30,
    departmentId?: string,
  ): Promise<number> {
    const since = this.dateService.daysAgo(daysAgo);

    const totalWorkers = await this.memberService.count({
      where: {
        role: MemberRoleEnum.WORKER,
        ...(departmentId
          ? { workerProfile: { department: { id: departmentId } } }
          : {}),
      },
    });

    if (totalWorkers === 0) return 0;

    const qb = this.attendanceRepository
      .createQueryBuilder('attendance')
      .innerJoin('attendance.member', 'member')
      .innerJoin('member.workerProfile', 'profile')
      .where('attendance.createdAt >= :since', { since })
      .andWhere(`attendance.status IN ('PRESENT','LATE')`)
      .andWhere('profile.status = :wStatus', {
        wStatus: WorkerStatusEnum.ACTIVE,
      });

    if (departmentId)
      qb.andWhere('profile.department.id = :departmentId', { departmentId });

    const { count } = await qb
      .select('COUNT(DISTINCT member.id)', 'count')
      .getRawOne<{ count: string }>();

    const attended = Number.parseInt(count ?? '0', 10);
    return Math.min(Number(((attended / totalWorkers) * 100).toFixed(2)), 100);
  }

  async getCongregationAttendancePercentage(daysAgo = 30): Promise<number> {
    const since = this.dateService.daysAgo(daysAgo);

    const totalActive = await this.memberService.count({
      where: { status: MemberStatusEnum.ACTIVE },
    });
    if (totalActive === 0) return 0;

    const { count } = await this.attendanceRepository
      .createQueryBuilder('attendance')
      .select('COUNT(DISTINCT attendance.member_id)', 'count')
      .where('attendance.createdAt >= :since', { since })
      .andWhere(`attendance.status IN ('PRESENT','LATE')`)
      .getRawOne<{ count: string }>();

    const attended = Number.parseInt(count ?? '0', 10);
    return Math.min(Number(((attended / totalActive) * 100).toFixed(2)), 100);
  }

  async getDepartmentAttendanceSummary(
    daysAgo = 30,
  ): Promise<DepartmentAttendanceSummary[]> {
    const since = this.dateService.daysAgo(daysAgo);

    const rows = await this.dataSource
      .createQueryBuilder()
      .select('dept.id', 'departmentId')
      .addSelect('dept.name', 'departmentName')
      .addSelect('COUNT(DISTINCT wp.member_id)', 'totalWorkers')
      .addSelect(
        `COUNT(DISTINCT CASE WHEN a.status IN ('PRESENT','LATE') THEN a.member_id END)`,
        'attendedWorkers',
      )
      .from('departments', 'dept')
      .leftJoin(
        'worker_profiles',
        'wp',
        "wp.department_id = dept.id AND wp.status = 'ACTIVE'",
      )
      .leftJoin(
        'attendances',
        'a',
        "a.member_id = wp.member_id AND a.created_at >= :since AND a.role_at_checkin = 'WORKER'",
        { since },
      )
      .groupBy('dept.id, dept.name')
      .orderBy('dept.name', 'ASC')
      .getRawMany<{
        departmentId: string;
        departmentName: string;
        totalWorkers: string;
        attendedWorkers: string;
      }>();

    return rows.map((r) => {
      const total = Number.parseInt(r.totalWorkers, 10);
      const attended = Number.parseInt(r.attendedWorkers, 10);
      return {
        departmentId: r.departmentId,
        departmentName: r.departmentName,
        totalWorkers: total,
        attendedWorkers: attended,
        attendancePercentage:
          total === 0
            ? 0
            : Math.min(Number(((attended / total) * 100).toFixed(2)), 100),
      };
    });
  }

  async getNewMemberRegistrationsTrend(
    daysAgo = 90,
  ): Promise<{ week: string; newMembers: number; newWorkers: number }[]> {
    const since = this.dateService.daysAgo(daysAgo);

    const rows = await this.dataSource
      .createQueryBuilder()
      .select("TO_CHAR(DATE_TRUNC('week', m.created_at), 'YYYY-MM-DD')", 'week')
      .addSelect(
        `SUM(CASE WHEN m.role = 'MEMBER' THEN 1 ELSE 0 END)`,
        'newMembers',
      )
      .addSelect(
        `SUM(CASE WHEN m.role = 'WORKER' THEN 1 ELSE 0 END)`,
        'newWorkers',
      )
      .from('members', 'm')
      .where('m.created_at >= :since', { since })
      .groupBy("DATE_TRUNC('week', m.created_at)")
      .orderBy("DATE_TRUNC('week', m.created_at)", 'ASC')
      .getRawMany<{ week: string; newMembers: string; newWorkers: string }>();

    return rows.map((r) => ({
      week: r.week,
      newMembers: Number.parseInt(r.newMembers, 10),
      newWorkers: Number.parseInt(r.newWorkers, 10),
    }));
  }

  async getAttendanceStreak(
    memberId: string,
    role: MemberRoleEnum,
  ): Promise<number> {
    // Raw select (not repository.find with a `select` array) — TypeORM's
    // find-with-relation-where + take/select combination generates a
    // subquery-based pagination strategy that references the (excluded)
    // primary key column and fails with "column distinctAlias.Attendance_id
    // does not exist".
    const records = await this.attendanceRepository
      .createQueryBuilder('attendance')
      .select('attendance.status', 'status')
      .where('attendance.member_id = :memberId', { memberId })
      .andWhere('attendance.roleAtCheckin = :role', { role })
      .orderBy('attendance.createdAt', 'DESC')
      .limit(500)
      .getRawMany<{ status: AttendanceStatusEnum }>();

    let streak = 0;
    for (const record of records) {
      if (record.status === AttendanceStatusEnum.ON_LEAVE) continue;
      if (
        record.status === AttendanceStatusEnum.PRESENT ||
        record.status === AttendanceStatusEnum.LATE ||
        record.status === AttendanceStatusEnum.ATTENDED_ONLINE
      ) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }

  // Lifetime summary (rate + streak) computed entirely in SQL over the
  // member's full history — this backs the mobile app's account/history
  // screen, which previously derived these from just the first page of
  // /my-history results (wrong for anyone with more than a page of records).
  // ON_LEAVE is excluded from both numerator and denominator: an approved
  // leave shouldn't count against the rate. "Attended" mirrors
  // getAttendanceStreak's convention (PRESENT/LATE/ATTENDED_ONLINE).
  async getMyAttendanceSummary(
    memberId: string,
    role: MemberRoleEnum,
  ): Promise<MyAttendanceSummary> {
    const { total, attended, lastCheckin } = await this.attendanceRepository
      .createQueryBuilder('attendance')
      .select('COUNT(*)', 'total')
      .addSelect(
        `SUM(CASE WHEN attendance.status IN ('PRESENT','LATE','ATTENDED_ONLINE') THEN 1 ELSE 0 END)`,
        'attended',
      )
      .addSelect('MAX(attendance.checkinTime)', 'lastCheckin')
      .where('attendance.member_id = :memberId', { memberId })
      .andWhere('attendance.roleAtCheckin = :role', { role })
      .andWhere(`attendance.status != 'ON_LEAVE'`)
      .getRawOne<{
        total: string;
        attended: string;
        lastCheckin: string | null;
      }>();

    const totalCount = Number.parseInt(total ?? '0', 10);
    const presentCount = Number.parseInt(attended ?? '0', 10);
    const attendanceRatePercentage =
      totalCount === 0 ? 0 : Math.round((presentCount / totalCount) * 100);
    const attendanceStreak = await this.getAttendanceStreak(memberId, role);

    return {
      totalCount,
      presentCount,
      attendanceRatePercentage,
      lastCheckedInDate: lastCheckin ? new Date(lastCheckin) : null,
      attendanceStreak,
    };
  }

  async getPeriodStats(
    memberId: string,
    daysAgo: number,
  ): Promise<{
    present: number;
    late: number;
    absent: number;
    onLeave: number;
    total: number;
  }> {
    const since = this.dateService.daysAgo(daysAgo);
    const rows = await this.attendanceRepository
      .createQueryBuilder('attendance')
      .select('attendance.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('attendance.member_id = :memberId', { memberId })
      .andWhere('attendance.createdAt >= :since', { since })
      .groupBy('attendance.status')
      .getRawMany<{ status: AttendanceStatusEnum; count: string }>();

    const stats = { present: 0, late: 0, absent: 0, onLeave: 0, total: 0 };
    for (const row of rows) {
      const n = Number.parseInt(row.count, 10);
      stats.total += n;
      if (row.status === AttendanceStatusEnum.PRESENT) stats.present = n;
      if (row.status === AttendanceStatusEnum.LATE) stats.late = n;
      if (row.status === AttendanceStatusEnum.ABSENT) stats.absent = n;
      if (row.status === AttendanceStatusEnum.ON_LEAVE) stats.onLeave = n;
    }
    return stats;
  }

  async getMemberRank(
    memberId: string,
    daysAgo: number,
    role: MemberRoleEnum,
  ): Promise<number> {
    const since = this.dateService.daysAgo(daysAgo);

    const ownRow = await this.attendanceRepository
      .createQueryBuilder('a')
      .select(
        `COALESCE(SUM(CASE WHEN a.status IN ('PRESENT','LATE') THEN 1 ELSE 0 END), 0)`,
        'score',
      )
      .where('a.member_id = :memberId', { memberId })
      .andWhere('a.roleAtCheckin = :role', { role })
      .andWhere('a.createdAt >= :since', { since })
      .getRawOne<{ score: string }>();

    const ownScore = Number.parseInt(ownRow?.score ?? '0', 10);

    // Count members who outscored this one — wraps a GROUP BY/HAVING in a subquery COUNT
    const [{ count }] = await this.dataSource.query<{ count: string }[]>(
      `SELECT COUNT(*) AS count
             FROM (
                 SELECT member_id
                 FROM attendances
                 WHERE role_at_checkin = $1
                   AND created_at >= $2
                   AND member_id != $3
                 GROUP BY member_id
                 HAVING SUM(CASE WHEN status IN ('PRESENT','LATE') THEN 1 ELSE 0 END) > $4
             ) ranked`,
      [role, since, memberId, ownScore],
    );

    return Number.parseInt(count ?? '0', 10) + 1;
  }

  async getWeeklyAttendanceTrend(
    daysAgo = 90,
  ): Promise<{ week: string; present: number; absent: number }[]> {
    const since = this.dateService.daysAgo(daysAgo);
    const rows = await this.attendanceRepository
      .createQueryBuilder('attendance')
      .select(
        "TO_CHAR(DATE_TRUNC('week', attendance.createdAt), 'YYYY-MM-DD')",
        'week',
      )
      .addSelect(
        `SUM(CASE WHEN attendance.status IN ('PRESENT','LATE') THEN 1 ELSE 0 END)`,
        'present',
      )
      .addSelect(
        `SUM(CASE WHEN attendance.status = 'ABSENT' THEN 1 ELSE 0 END)`,
        'absent',
      )
      .where('attendance.createdAt >= :since', { since })
      .groupBy("DATE_TRUNC('week', attendance.createdAt)")
      .orderBy("DATE_TRUNC('week', attendance.createdAt)", 'ASC')
      .getRawMany<{ week: string; present: string; absent: string }>();

    return rows.map((r) => ({
      week: r.week,
      present: Number.parseInt(r.present, 10),
      absent: Number.parseInt(r.absent, 10),
    }));
  }

  async getMembersNotSeenSince(
    daysAgo = 30,
    limit = 20,
  ): Promise<
    { id: string; name: string; email: string; lastSeen: Date | null }[]
  > {
    const since = this.dateService.daysAgo(daysAgo);
    const rows = await this.dataSource
      .createQueryBuilder()
      .select('m.id', 'id')
      .addSelect('m.firstname', 'firstname')
      .addSelect('m.lastname', 'lastname')
      .addSelect('m.email', 'email')
      .addSelect('MAX(a.checkin_time)', 'lastSeen')
      .from('members', 'm')
      .leftJoin(
        'attendances',
        'a',
        "a.member_id = m.id AND a.status IN ('PRESENT','LATE')",
      )
      .where('m.status = :status', { status: 'ACTIVE' })
      .groupBy('m.id, m.firstname, m.lastname, m.email')
      .having('MAX(a.checkin_time) < :since OR MAX(a.checkin_time) IS NULL', {
        since,
      })
      .orderBy('MAX(a.checkin_time)', 'ASC', 'NULLS FIRST')
      .limit(limit)
      .getRawMany<{
        id: string;
        firstname: string;
        lastname: string;
        email: string;
        lastSeen: Date | null;
      }>();

    return rows.map((r) => ({
      id: r.id,
      name: `${r.firstname} ${r.lastname}`,
      email: r.email,
      lastSeen: r.lastSeen ?? null,
    }));
  }

  async getTopAbsentMembers(
    daysAgo = 30,
    limit = 10,
    role?: MemberRoleEnum,
  ): Promise<
    {
      id: string;
      name: string;
      department: string | null;
      absentCount: number;
    }[]
  > {
    const since = this.dateService.daysAgo(daysAgo);

    const qb = this.attendanceRepository
      .createQueryBuilder('attendance')
      .select('member.id', 'id')
      .addSelect('member.firstname', 'firstname')
      .addSelect('member.lastname', 'lastname')
      .addSelect('dept.name', 'department')
      .addSelect(
        `SUM(CASE WHEN attendance.status = 'ABSENT' THEN 1 ELSE 0 END)`,
        'absentCount',
      )
      .innerJoin('attendance.member', 'member')
      .leftJoin('member.workerProfile', 'profile')
      .leftJoin('profile.department', 'dept')
      .where('attendance.createdAt >= :since', { since })
      .groupBy('member.id, member.firstname, member.lastname, dept.name')
      .having(
        `SUM(CASE WHEN attendance.status = 'ABSENT' THEN 1 ELSE 0 END) > 0`,
      )
      .orderBy('"absentCount"', 'DESC')
      .limit(limit);

    if (role) qb.andWhere('attendance.roleAtCheckin = :role', { role });

    const rows = await qb.getRawMany<{
      id: string;
      firstname: string;
      lastname: string;
      department: string | null;
      absentCount: string;
    }>();

    return rows.map((r) => ({
      id: r.id,
      name: `${r.firstname} ${r.lastname}`,
      department: r.department ?? null,
      absentCount: Number.parseInt(r.absentCount, 10),
    }));
  }

  async correctAttendance(
    id: string,
    status: AttendanceStatusEnum,
    actorId: string,
  ): Promise<Attendance> {
    const record = await this.attendanceRepository.findOne({
      where: { id },
      relations: ['member', 'event'],
    });
    if (!record) throw new NotFoundException('Attendance record not found');
    const previousStatus = record.status;
    record.status = status;
    const saved = await this.attendanceRepository.save(record);
    this.logger.log(
      `Admin ${actorId} corrected attendance ${id}: ${previousStatus} → ${status} ` +
        `(member=${record.member?.id}, event=${record.event?.id})`,
    );
    return saved;
  }

  // Covers two cases with one action: checking in someone who has no phone
  // (no row exists yet for this member+event) and "restoring a streak" for
  // someone who was auto-marked ABSENT (a row exists — just flip it). Streak
  // is computed live from these rows (see getAttendanceStreak), so there is
  // no separate streak field to repair — fixing the row is the whole fix.
  async adminMarkAttendance(
    memberId: string,
    serviceSlotId: string,
    status: AttendanceStatusEnum,
    actorId: string,
  ): Promise<Attendance> {
    const [slot, member] = await Promise.all([
      this.getSlotOrThrow(serviceSlotId),
      this.memberService.getById(memberId),
    ]);

    let record = await this.attendanceRepository.findOne({
      where: { member: { id: memberId }, event: { id: slot.event.id } },
    });

    if (record) {
      record.status = status;
      record.serviceSlot = slot;
      record.checkinTime = record.checkinTime ?? this.dateService.now();
    } else {
      record = this.attendanceRepository.create({
        member,
        event: slot.event,
        serviceSlot: slot,
        checkinTime: this.dateService.now(),
        status,
        roleAtCheckin: member.role,
        location: null,
      });
    }

    const saved = await this.attendanceRepository.save(record);
    this.auditLogService.log('ATTENDANCE_ADMIN_MARKED', {
      actorId,
      targetId: member.id,
      targetEmail: member.email,
      targetName: `${member.firstname} ${member.lastname}`,
      metadata: { eventId: slot.event.id, serviceSlotId, status },
    });
    this.logger.log(
      `${actorId} marked attendance for member ${memberId} on event ${slot.event.id}: ${status}`,
    );
    return saved;
  }

  // Mobile-only gate for Admin-department workers (front-desk staff who need
  // to check people in without going through the admin portal).
  async assertIsAdminDeptWorker(memberId: string): Promise<void> {
    await this.departmentAccessService.assertHasCapability(
      memberId,
      DepartmentCapability.FRONT_DESK_OPERATIONS,
      'Only Front Desk Operations workers can perform this action',
    );
  }

  // Backs the mobile check-in flow's member picker — deliberately scoped to
  // Admin-department workers only (via assertIsAdminDeptWorker), returning
  // minimal fields (see MemberService.searchActiveMembersLite) rather than a
  // general member-search surface.
  async searchMembersForCheckin(actorId: string, query: string) {
    await this.assertIsAdminDeptWorker(actorId);
    return this.memberService.searchActiveMembersLite(query);
  }

  async getTotalCheckInsToday(): Promise<number> {
    const startOfDay = this.dateService.startOfDay();
    const endOfDay = this.dateService.endOfDay();
    return this.attendanceRepository.count({
      where: { checkinTime: Between(startOfDay, endOfDay) },
    });
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async getSlotOrThrow(slotId: string): Promise<ServiceSlot> {
    const slot = await this.slotRepository.findOne({
      where: { id: slotId },
      relations: ['event', 'config', 'config.defaultVenue', 'venueOverride'],
    });
    if (!slot) throw new NotFoundException('Service slot not found');
    return slot;
  }

  private assertMemberActive(member: Member): void {
    if (member.status === MemberStatusEnum.INACTIVE) {
      throw new BadRequestException('Your account is inactive. Contact admin.');
    }
    if (
      member.role === MemberRoleEnum.WORKER &&
      member.workerProfile?.status === WorkerStatusEnum.INACTIVE
    ) {
      throw new BadRequestException(
        'Your worker account is suspended. Contact admin.',
      );
    }
  }

  private validateCheckinWindow(
    now: Date,
    slot: ServiceSlot,
    cfg: ReturnType<EventService['resolveSlotConfig']>,
    isWorker: boolean,
  ): void {
    const startOffset = isWorker
      ? cfg.workerCheckinStartOffsetSeconds
      : cfg.memberCheckinStartOffsetSeconds;

    const openTime = this.dateService.addSeconds(slot.startTime, startOffset);
    const closeTime = this.dateService.addSeconds(
      slot.startTime,
      cfg.checkinStopOffsetSeconds,
    );

    if (this.dateService.isBefore(now, openTime)) {
      throw new BadRequestException('Check-in has not opened yet.');
    }
    if (this.dateService.isAfter(now, closeTime)) {
      throw new BadRequestException('Check-in is closed.');
    }
  }

  private async validateLocation(
    location: { latitude: number; longitude: number },
    cfg: ReturnType<EventService['resolveSlotConfig']>,
  ): Promise<void> {
    const distance = UtilityService.calculateDistanceInMeters(
      location.latitude,
      location.longitude,
      cfg.venue.latitude,
      cfg.venue.longitude,
    );
    if (
      distance > cfg.allowedDistanceInMeters &&
      (await this.enforceDistance())
    ) {
      throw new BadRequestException(
        'You are too far from the venue to check in.',
      );
    }
  }

  private resolveStatus(
    now: Date,
    slot: ServiceSlot,
    cfg: ReturnType<EventService['resolveSlotConfig']>,
    isWorker: boolean,
  ): AttendanceStatusEnum {
    if (!isWorker) return AttendanceStatusEnum.PRESENT;
    const lateThreshold = this.dateService.addSeconds(
      slot.startTime,
      cfg.workerLateOffsetSeconds,
    );
    return this.dateService.isSameOrAfter(now, lateThreshold)
      ? AttendanceStatusEnum.LATE
      : AttendanceStatusEnum.PRESENT;
  }

  private buildAbsenceRecord(
    member: Member,
    event: Event,
    role: MemberRoleEnum,
    onLeave: boolean,
  ): Partial<Attendance> {
    return {
      member,
      event,
      serviceSlot: null,
      checkinTime: null,
      status: onLeave
        ? AttendanceStatusEnum.ON_LEAVE
        : AttendanceStatusEnum.ABSENT,
      roleAtCheckin: role,
      location: null,
    };
  }

  private async alreadyCheckedIn(
    memberId: string,
    eventId: string,
  ): Promise<Attendance | null> {
    return this.attendanceRepository.findOne({
      where: { member: { id: memberId }, event: { id: eventId } },
      select: { id: true, status: true, checkinTime: true },
    });
  }

  private async getBatchApprovedLeave(
    memberIds: string[],
    event: Event,
  ): Promise<Set<string>> {
    if (!memberIds.length) return new Set();
    const rows = await this.dataSource
      .createQueryBuilder()
      .select('profile.member_id', 'memberId')
      .from('request_leave', 'leave')
      .innerJoin(
        'worker_profiles',
        'profile',
        'profile.id = leave.worker_profile_id',
      )
      .where('profile.member_id IN (:...memberIds)', { memberIds })
      .andWhere('leave.status = :status', { status: 'APPROVED' })
      .andWhere('leave.date_from <= :eventDate', { eventDate: event.eventDate })
      .andWhere('leave.date_to >= :eventDate', { eventDate: event.eventDate })
      .getRawMany<{ memberId: string }>();
    return new Set(rows.map((r) => r.memberId));
  }

  private async enforceDistance(): Promise<boolean> {
    return this.attendanceSettingsService.isEnabled();
  }

  async getAtRiskMembers(
    minAbsences = 3,
    from?: string,
    to?: string,
    page = 1,
    limit = 20,
  ) {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');
    const offset = (page - 1) * limit;

    const params: (string | number)[] = [
      AttendanceStatusEnum.ABSENT,
      minAbsences,
      limit,
      offset,
    ];
    let dateFilter = '';
    if (from && to) {
      dateFilter = `AND a.created_at BETWEEN $5 AND $6`;
      params.push(from, to);
    }

    const rows: {
      id: string;
      firstname: string;
      lastname: string;
      email: string;
      phone_number: string;
      absence_count: string;
      last_seen_at: Date | null;
      has_open_task: boolean;
    }[] = await this.dataSource.query(
      `SELECT
         m.id,
         m.firstname,
         m.lastname,
         m.email,
         m.phone_number,
         COUNT(a.id)::int AS absence_count,
         (SELECT MAX(a2.checkin_time)
          FROM attendances a2
          WHERE a2.member_id = m.id
            AND a2.status IN ('PRESENT','LATE','ATTENDED_ONLINE')) AS last_seen_at,
         EXISTS(
           SELECT 1 FROM follow_up_tasks ft
           WHERE ft.member_id = m.id
             AND ft.status IN ('PENDING','IN_PROGRESS')
         ) AS has_open_task
       FROM members m
       JOIN attendances a ON a.member_id = m.id AND a.status = $1 ${dateFilter}
       GROUP BY m.id, m.firstname, m.lastname, m.email, m.phone_number
       HAVING COUNT(a.id) >= $2
       ORDER BY COUNT(a.id) DESC
       LIMIT $3 OFFSET $4`,
      params,
    );

    const countRows: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total
       FROM (
         SELECT m.id
         FROM members m
         JOIN attendances a ON a.member_id = m.id AND a.status = $1 ${dateFilter}
         GROUP BY m.id
         HAVING COUNT(a.id) >= $2
       ) sub`,
      from && to
        ? [AttendanceStatusEnum.ABSENT, minAbsences, from, to]
        : [AttendanceStatusEnum.ABSENT, minAbsences],
    );

    const total = Number(countRows[0]?.total ?? 0);
    const data = rows.map((r) => ({
      id: r.id,
      firstname: r.firstname,
      lastname: r.lastname,
      email: r.email,
      phoneNumber: r.phone_number,
      absenceCount: Number(r.absence_count),
      lastSeenAt: r.last_seen_at ?? null,
      hasOpenFollowUpTask: r.has_open_task,
    }));

    return UtilityService.createPaginationResponse(data, page, limit, total);
  }
}
