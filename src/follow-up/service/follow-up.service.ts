import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { FirstTimer } from '../entity/first-timer.entity';
import { FollowUpTask } from '../entity/follow-up-task.entity';
import { FollowUpNote } from '../entity/follow-up-note.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { CreateFirstTimerDto } from '../dto/create-first-timer.dto';
import { UpdateFirstTimerDto } from '../dto/update-first-timer.dto';
import { UpdateFollowUpTaskDto } from '../dto/update-follow-up-task.dto';
import { AdminUpdateFollowUpTaskDto } from '../dto/admin-update-follow-up-task.dto';
import { BulkUpdateTasksDto } from '../dto/bulk-update-tasks.dto';
import { ReassignTaskDto } from '../dto/reassign-task.dto';
import {
  FirstTimerSourceEnum,
  FollowUpOutcomeEnum,
  FollowUpTaskStatusEnum,
  FollowUpTaskTypeEnum,
} from '../enums/follow-up.enum';
import { FirstTimerVisit } from '../entity/first-timer-visit.entity';
import { LogVisitDto } from '../dto/log-visit.dto';
import { AddNoteDto } from '../dto/add-note.dto';
import { DepartmentCapability } from '../../department/enums/department-capability.enum';
import { DepartmentAccessService } from '../../department/service/department-access.service';
import { WorkerStatusEnum } from '../../member/enums/worker-status.enum';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { CacheService } from '../../utility/service/cache.service';
import { EmailQueueService } from '../../utility/service/email-queue.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { Event } from '../../event/entity/event.entity';
import { SundaySchoolAttendance } from '../../sunday-school/entity/sunday-school-attendance.entity';

export interface PublicEventOption {
  id: string;
  name: string;
  eventDate: Date;
}

export interface FirstTimerTimelineEntry {
  source: 'INITIAL_VISIT' | 'LOGGED_VISIT' | 'SUNDAY_SCHOOL';
  label: string;
  occurredAt: Date | string;
  notes?: string | null;
}

export interface FirstTimerDetail {
  firstTimer: FirstTimer;
  visitCount: number;
  timeline: FirstTimerTimelineEntry[];
}

const REPORT_CACHE_TTL = 300;

const OPEN_STATUSES = [
  FollowUpTaskStatusEnum.PENDING,
  FollowUpTaskStatusEnum.IN_PROGRESS,
];

@Injectable()
export class FollowUpService {
  private readonly followUpDueDays: number;
  private readonly churchName: string;

  constructor(
    // Kept for the plain reads elsewhere in this file (createQueryBuilder/
    // query calls on this.dataSource) — but doCreateFirstTimer below
    // deliberately does NOT use dataSource.transaction(); see there.
    private readonly dataSource: DataSource,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly emailQueueService: EmailQueueService,
    private readonly auditLogService: AuditLogService,
    @InjectRepository(FirstTimer)
    private readonly firstTimerRepo: Repository<FirstTimer>,
    @InjectRepository(FollowUpTask)
    private readonly taskRepo: Repository<FollowUpTask>,
    @InjectRepository(FollowUpNote)
    private readonly noteRepo: Repository<FollowUpNote>,
    @InjectRepository(WorkerProfile)
    private readonly workerProfileRepo: Repository<WorkerProfile>,
    @InjectRepository(FirstTimerVisit)
    private readonly visitRepo: Repository<FirstTimerVisit>,
    @InjectRepository(Event)
    private readonly eventRepo: Repository<Event>,
    @InjectRepository(SundaySchoolAttendance)
    private readonly sundaySchoolAttendanceRepo: Repository<SundaySchoolAttendance>,
    private readonly departmentAccessService: DepartmentAccessService,
  ) {
    this.followUpDueDays = this.configService.get<number>('FOLLOW_UP_DUE_DAYS');
    this.churchName = this.configService.get<string>('CHURCH_NAME');
  }

  private readonly logger = new Logger(FollowUpService.name);

  async createFirstTimerByWorker(
    dto: CreateFirstTimerDto,
    memberId: string,
  ): Promise<FirstTimer> {
    await this.assertWorkerInFollowUpDept(memberId);
    const created = await this.doCreateFirstTimer(dto, {
      memberCreatorId: memberId,
    });
    this.logger.log(`First-timer ${created.id} recorded by worker ${memberId}`);
    return created;
  }

  async createFirstTimerByAdmin(
    dto: CreateFirstTimerDto,
    adminId: string,
  ): Promise<FirstTimer> {
    const created = await this.doCreateFirstTimer(dto, {
      adminCreatorId: adminId,
    });
    this.logger.log(`First-timer ${created.id} recorded by admin ${adminId}`);
    return created;
  }

  // Called from FormSubmissionService when a PUBLIC form flagged
  // createsFirstTimers is submitted — no caller identity at all (an
  // anonymous visitor via a QR code/shared link), same as the empty actor
  // object an unauthenticated submission naturally produces. source is
  // forced to ONLINE regardless of whatever the DTO carries, since this
  // pathway *is* the online-intake mechanism — it shouldn't be spoofable
  // by whatever a form's fields happen to submit.
  async createFirstTimerFromPublicForm(
    dto: CreateFirstTimerDto,
  ): Promise<FirstTimer> {
    const created = await this.doCreateFirstTimer(
      { ...dto, source: FirstTimerSourceEnum.ONLINE },
      {},
    );
    this.logger.log(
      `First-timer ${created.id} recorded via public form (online intake)`,
    );
    return created;
  }

  // Called from the member app's own signup screen (unauthenticated,
  // FollowUpPublicController) — a visitor who installs the app but isn't
  // ready to create a full member account yet can still let the church
  // know they're here. Same no-actor, forced-source shape as
  // createFirstTimerFromPublicForm, distinct source value so this channel
  // is analytically distinguishable from a QR/shared-link public form.
  async createFirstTimerFromAppSignup(
    dto: CreateFirstTimerDto,
  ): Promise<FirstTimer> {
    const created = await this.doCreateFirstTimer(
      { ...dto, source: FirstTimerSourceEnum.APP_SIGNUP },
      {},
    );
    this.logger.log(
      `First-timer ${created.id} recorded via app signup self-onboarding`,
    );
    return created;
  }

  // Called from SundaySchoolService when a teacher checks in someone with
  // no Member record during class — deliberately bypasses
  // assertWorkerInFollowUpDept (a Sunday School teacher has no reason to
  // hold MANAGE_FOLLOW_UP capability); the caller is already authorized by
  // SundaySchoolService.requireSundaySchoolAuth before this is ever
  // reached. source is forced to SUNDAY_SCHOOL regardless of the DTO, same
  // reasoning as createFirstTimerFromPublicForm forcing ONLINE.
  async createFirstTimerFromSundaySchoolCheckIn(
    dto: CreateFirstTimerDto,
    memberId: string,
  ): Promise<FirstTimer> {
    const created = await this.doCreateFirstTimer(
      { ...dto, source: FirstTimerSourceEnum.SUNDAY_SCHOOL },
      { memberCreatorId: memberId },
    );
    this.logger.log(
      `First-timer ${created.id} recorded via Sunday School check-in by ${memberId}`,
    );
    return created;
  }

  async getFirstTimers(
    page = 1,
    limit = 20,
    eventId?: string,
    source?: FirstTimerSourceEnum,
    wantsToJoinChurch?: boolean,
    wantsToJoinWorkforce?: boolean,
    search?: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<PaginationResponseDto<FirstTimer>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');

    const qb = this.firstTimerRepo
      .createQueryBuilder('ft')
      .leftJoinAndSelect('ft.visitedEvent', 'event')
      .leftJoinAndSelect('ft.followUpTask', 'task')
      .leftJoinAndSelect('task.assignedTo', 'wp')
      .leftJoinAndSelect('wp.member', 'wm')
      .loadRelationCountAndMap('ft.visitCount', 'ft.visits')
      .orderBy('ft.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (eventId) qb.andWhere('event.id = :eventId', { eventId });
    if (source) qb.andWhere('ft.source = :source', { source });
    if (wantsToJoinChurch !== undefined)
      qb.andWhere('ft.wantsToJoinChurch = :wantsToJoinChurch', {
        wantsToJoinChurch,
      });
    if (wantsToJoinWorkforce !== undefined)
      qb.andWhere('ft.wantsToJoinWorkforce = :wantsToJoinWorkforce', {
        wantsToJoinWorkforce,
      });
    if (search) {
      qb.andWhere(
        '(LOWER(ft.firstname) LIKE :search OR LOWER(ft.lastname) LIKE :search OR ft.phone LIKE :search OR LOWER(ft.email) LIKE :search)',
        { search: `%${search.toLowerCase()}%` },
      );
    }
    if (dateFrom) qb.andWhere('ft.createdAt >= :dateFrom', { dateFrom });
    if (dateTo) qb.andWhere('ft.createdAt <= :dateTo', { dateTo });

    const [data, total] = await qb.getManyAndCount();

    // Sunday School check-ins aren't covered by loadRelationCountAndMap
    // above, so batch them separately (avoid N+1). +1 per row is the
    // initial visit, which has no row of its own.
    if (data.length) {
      const ids = data.map((ft) => ft.id);
      const ssCounts = await this.sundaySchoolAttendanceRepo
        .createQueryBuilder('ssa')
        .select('ssa.first_timer_id', 'firstTimerId')
        .addSelect('COUNT(*)', 'count')
        .where('ssa.first_timer_id IN (:...ids)', { ids })
        .groupBy('ssa.first_timer_id')
        .getRawMany<{ firstTimerId: string; count: string }>();
      const ssCountByFirstTimerId = new Map(
        ssCounts.map((r) => [r.firstTimerId, Number(r.count)]),
      );
      for (const ft of data) {
        ft.visitCount =
          1 + (ft.visitCount ?? 0) + (ssCountByFirstTimerId.get(ft.id) ?? 0);
      }
    }

    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  // Shared by the admin and worker detail endpoints.
  private async buildFirstTimerDetail(
    firstTimer: FirstTimer,
  ): Promise<FirstTimerDetail> {
    const sundaySchoolCheckIns = await this.sundaySchoolAttendanceRepo.find({
      where: { firstTimer: { id: firstTimer.id } },
      relations: ['session', 'session.sundaySchoolClass'],
      order: { markedAt: 'ASC' },
    });

    const timeline: FirstTimerTimelineEntry[] = [
      {
        source: 'INITIAL_VISIT' as const,
        label: firstTimer.visitedEvent?.name ?? 'Initial visit',
        occurredAt: firstTimer.createdAt,
      },
      ...(firstTimer.visits ?? []).map((v) => ({
        source: 'LOGGED_VISIT' as const,
        label: v.event?.name ?? 'Return visit',
        occurredAt: v.visitedAt,
        notes: v.notes ?? null,
      })),
      ...sundaySchoolCheckIns.map((c) => ({
        source: 'SUNDAY_SCHOOL' as const,
        label: c.session.sundaySchoolClass.name,
        occurredAt: c.session.sessionDate,
      })),
    ].sort(
      (a, b) =>
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );

    return { firstTimer, visitCount: timeline.length, timeline };
  }

  async getFirstTimerDetail(id: string): Promise<FirstTimerDetail> {
    const firstTimer = await this.firstTimerRepo.findOne({
      where: { id },
      relations: ['visits', 'visits.event', 'visitedEvent', 'convertedMember'],
    });
    if (!firstTimer) throw new NotFoundException('First timer not found');
    return this.buildFirstTimerDetail(firstTimer);
  }

  async getFirstTimerDetailForWorker(
    id: string,
    memberId: string,
  ): Promise<FirstTimerDetail> {
    await this.assertWorkerInFollowUpDept(memberId);
    return this.getFirstTimerDetail(id);
  }

  async getMyTasks(
    memberId: string,
    page = 1,
    limit = 20,
    status?: FollowUpTaskStatusEnum,
  ): Promise<PaginationResponseDto<FollowUpTask>> {
    await this.assertWorkerInFollowUpDept(memberId);

    const profile = await this.workerProfileRepo.findOne({
      where: { member: { id: memberId } },
    });
    if (!profile) throw new NotFoundException('Worker profile not found');

    if (page < 1) throw new BadRequestException('Page must be greater than 0');

    const qb = this.taskRepo
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.firstTimer', 'ft')
      .leftJoinAndSelect('task.member', 'member')
      .leftJoinAndSelect('task.event', 'event')
      .leftJoinAndSelect('task.notes', 'notes')
      .where('task.assignedTo = :profileId', { profileId: profile.id })
      .orderBy('task.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) qb.andWhere('task.status = :status', { status });

    const [data, total] = await qb.getManyAndCount();
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async getAllTasks(
    page = 1,
    limit = 20,
    status?: FollowUpTaskStatusEnum,
    type?: FollowUpTaskTypeEnum,
    search?: string,
  ): Promise<PaginationResponseDto<FollowUpTask>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');

    const qb = this.taskRepo
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.firstTimer', 'ft')
      .leftJoinAndSelect('task.member', 'member')
      .leftJoinAndSelect('task.event', 'event')
      .leftJoinAndSelect('task.assignedTo', 'wp')
      .leftJoinAndSelect('wp.member', 'wm')
      .orderBy('task.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) qb.andWhere('task.status = :status', { status });
    if (type) qb.andWhere('task.type = :type', { type });
    if (search) {
      qb.andWhere(
        '(LOWER(ft.firstname) LIKE :search OR LOWER(ft.lastname) LIKE :search)',
        { search: `%${search.toLowerCase()}%` },
      );
    }

    const [data, total] = await qb.getManyAndCount();
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async updateTask(
    taskId: string,
    dto: UpdateFollowUpTaskDto,
    memberId: string,
  ): Promise<FollowUpTask> {
    await this.assertWorkerInFollowUpDept(memberId);

    const profile = await this.workerProfileRepo.findOne({
      where: { member: { id: memberId } },
    });
    if (!profile) throw new NotFoundException('Worker profile not found');

    const task = await this.taskRepo.findOne({
      where: { id: taskId, assignedTo: { id: profile.id } },
      relations: ['assignedTo', 'notes'],
    });
    if (!task)
      throw new NotFoundException('Task not found or not assigned to you');

    if (dto.status) task.status = dto.status;
    if (dto.outcome) task.outcome = dto.outcome;
    if (dto.outcomeNotes !== undefined) task.outcomeNotes = dto.outcomeNotes;
    task.lastActivityAt = new Date();

    const saved = await this.taskRepo.save(task);
    this.logger.log(
      `Follow-up task ${taskId} updated by member ${memberId} (status: ${saved.status})`,
    );

    if (dto.noteContent) {
      await this.noteRepo.save(
        this.noteRepo.create({
          task: saved,
          addedBy: profile,
          content: dto.noteContent,
          contactMethod: dto.contactMethod ?? null,
        }),
      );
    }

    this.cacheService.flushNamespace('follow-up:report');
    return saved;
  }

  async reassignTask(
    taskId: string,
    dto: ReassignTaskDto,
    _actorAdminId: string,
  ): Promise<FollowUpTask> {
    const [task, targetProfile] = await Promise.all([
      this.taskRepo.findOne({
        where: { id: taskId },
        relations: ['assignedTo', 'firstTimer', 'member'],
      }),
      this.workerProfileRepo.findOne({
        where: { id: dto.workerProfileId },
        relations: ['department', 'member'],
      }),
    ]);

    if (!task) throw new NotFoundException('Task not found');
    if (!targetProfile) throw new NotFoundException('Worker profile not found');

    const isInFollowUpDept = await this.isFollowUpWorker(targetProfile);
    if (!isInFollowUpDept) {
      throw new BadRequestException(
        'Target worker must be in the Follow-Up department',
      );
    }
    if (targetProfile.status !== WorkerStatusEnum.ACTIVE) {
      throw new BadRequestException('Target worker is not active');
    }

    task.assignedTo = targetProfile;
    const saved = await this.taskRepo.save(task);
    this.logger.log(
      `Task ${taskId} reassigned to worker ${dto.workerProfileId}`,
    );
    this.cacheService.flushNamespace('follow-up:report');

    if (targetProfile.member?.email) {
      const contact = task.firstTimer ?? task.member;
      const contactName = contact
        ? `${contact.firstname} ${contact.lastname}`
        : 'Unknown';
      const contactPhone =
        (task.firstTimer?.phone ?? task.member?.phoneNumber) ||
        'See app for details';
      const contactEmail = task.firstTimer?.email ?? task.member?.email ?? null;

      this.emailQueueService.queueEmailWithTemplate(
        targetProfile.member.email,
        `Follow-Up Task Reassigned to You — ${this.churchName}`,
        'follow-up-task-assigned',
        {
          workerName: targetProfile.member.firstname,
          firstTimerName: contactName,
          phone: contactPhone,
          email: contactEmail,
          dueDate: task.dueDate
            ? new Date(task.dueDate).toDateString()
            : 'Not set',
          churchName: this.churchName,
        },
        undefined,
        EmailCategory.FOLLOW_UP,
      );
    }

    return saved;
  }

  async bulkUpdateTasks(dto: BulkUpdateTasksDto): Promise<{ updated: number }> {
    const ids = dto.tasks.map((t) => t.id);
    const tasks = await this.taskRepo.find({ where: { id: In(ids) } });

    const statusMap = new Map(dto.tasks.map((t) => [t.id, t.status]));
    for (const task of tasks) {
      const newStatus = statusMap.get(task.id);
      if (newStatus) task.status = newStatus;
    }

    await this.taskRepo.save(tasks);
    this.logger.log(`Bulk task update: ${tasks.length} task(s) updated`);
    this.cacheService.flushNamespace('follow-up:report');
    return { updated: tasks.length };
  }

  async createTaskForOnlineNonResponder(
    memberId: string,
    eventId: string,
  ): Promise<FollowUpTask | null> {
    const alreadyExists = await this.taskRepo.exists({
      where: {
        type: FollowUpTaskTypeEnum.ONLINE_NO_RESPONSE,
        member: { id: memberId },
        event: { id: eventId },
      },
    });
    if (alreadyExists) return null;

    const assignee = await this.pickRoundRobinAssignee();
    if (!assignee) return null;

    const dueDate = this.computeDueDate();

    const task = await this.taskRepo.save(
      this.taskRepo.create({
        type: FollowUpTaskTypeEnum.ONLINE_NO_RESPONSE,
        status: FollowUpTaskStatusEnum.PENDING,
        member: { id: memberId },
        event: { id: eventId },
        assignedTo: assignee,
        dueDate,
      }),
    );

    if (assignee.member?.email) {
      this.emailQueueService.queueEmailWithTemplate(
        assignee.member.email,
        `New Follow-Up Task Assigned — ${this.churchName}`,
        'follow-up-task-assigned',
        {
          workerName: assignee.member.firstname,
          firstTimerName: 'Online non-responder',
          phone: 'See app for details',
          email: null,
          dueDate: dueDate.toDateString(),
          churchName: this.churchName,
        },
        undefined,
        EmailCategory.FOLLOW_UP,
      );
    }

    this.logger.debug(
      `Online non-responder follow-up task created for member ${memberId} → assigned to ${assignee.id}`,
    );
    this.cacheService.flushNamespace('follow-up:report');
    return task;
  }

  async getReport(from?: Date, to?: Date) {
    const key = `follow-up:report:${from?.toISOString() ?? 'all'}:${to?.toISOString() ?? 'all'}`;
    return this.cacheService.getOrSet(
      key,
      () => this.fetchReport(from, to),
      REPORT_CACHE_TTL,
    );
  }

  private async fetchReport(from?: Date, to?: Date) {
    const hasRange = from !== undefined && to !== undefined;

    const [
      firstTimerRows,
      sourceRows,
      taskStatusRows,
      outcomeRows,
      overdueResult,
      workerRows,
      eventRows,
    ] = await Promise.all([
      // Total first-timers + wants-to-join counts
      (() => {
        const qb = this.dataSource
          .createQueryBuilder()
          .select('COUNT(*)', 'total')
          .addSelect(
            'SUM(CASE WHEN ft.wants_to_join_church THEN 1 ELSE 0 END)',
            'wantsToJoinChurch',
          )
          .addSelect(
            'SUM(CASE WHEN ft.wants_to_join_workforce THEN 1 ELSE 0 END)',
            'wantsToJoinWorkforce',
          )
          .from('first_timers', 'ft');
        if (hasRange)
          qb.where('ft.created_at BETWEEN :from AND :to', { from, to });
        return qb.getRawOne<{
          total: string;
          wantsToJoinChurch: string;
          wantsToJoinWorkforce: string;
        }>();
      })(),

      // By source
      (() => {
        const qb = this.dataSource
          .createQueryBuilder()
          .select('ft.source', 'source')
          .addSelect('COUNT(*)', 'count')
          .from('first_timers', 'ft')
          .groupBy('ft.source');
        if (hasRange)
          qb.where('ft.created_at BETWEEN :from AND :to', { from, to });
        return qb.getRawMany<{ source: string; count: string }>();
      })(),

      // Task status breakdown (tasks in period)
      (() => {
        const qb = this.dataSource
          .createQueryBuilder()
          .select('task.status', 'status')
          .addSelect('COUNT(*)', 'count')
          .from('follow_up_tasks', 'task')
          .groupBy('task.status');
        if (hasRange)
          qb.where('task.created_at BETWEEN :from AND :to', { from, to });
        return qb.getRawMany<{ status: string; count: string }>();
      })(),

      // Outcome breakdown
      (() => {
        const qb = this.dataSource
          .createQueryBuilder()
          .select('task.outcome', 'outcome')
          .addSelect('COUNT(*)', 'count')
          .from('follow_up_tasks', 'task')
          .where('task.outcome IS NOT NULL')
          .groupBy('task.outcome');
        if (hasRange)
          qb.andWhere('task.created_at BETWEEN :from AND :to', { from, to });
        return qb.getRawMany<{ outcome: string; count: string }>();
      })(),

      // Overdue count (always current snapshot, no date filter)
      this.dataSource
        .createQueryBuilder()
        .select('COUNT(*)', 'count')
        .from('follow_up_tasks', 'task')
        .where('task.status IN (:...statuses)', { statuses: OPEN_STATUSES })
        .andWhere('task.due_date < NOW()')
        .andWhere('task.due_date IS NOT NULL')
        .getRawOne<{ count: string }>(),

      // By worker
      (() => {
        const qb = this.dataSource
          .createQueryBuilder()
          .select("m.firstname || ' ' || m.lastname", 'workerName')
          .addSelect('COUNT(task.id)', 'assigned')
          .addSelect(
            `COUNT(CASE WHEN task.status = '${FollowUpTaskStatusEnum.COMPLETED}' THEN 1 END)`,
            'completed',
          )
          .addSelect(
            `COUNT(CASE WHEN task.outcome = '${FollowUpOutcomeEnum.JOINED}' THEN 1 END)`,
            'joined',
          )
          .from('follow_up_tasks', 'task')
          .innerJoin('worker_profiles', 'wp', 'wp.id = task.assigned_to_id')
          .innerJoin('members', 'm', 'm.id = wp.member_id')
          .groupBy('m.id, m.firstname, m.lastname')
          .orderBy('assigned', 'DESC');
        if (hasRange)
          qb.where('task.created_at BETWEEN :from AND :to', { from, to });
        return qb.getRawMany<{
          workerName: string;
          assigned: string;
          completed: string;
          joined: string;
        }>();
      })(),

      // By event
      (() => {
        const qb = this.dataSource
          .createQueryBuilder()
          .select('e.name', 'eventName')
          .addSelect('COUNT(ft.id)', 'firstTimers')
          .from('first_timers', 'ft')
          .innerJoin('events', 'e', 'e.id = ft.visited_event_id')
          .groupBy('e.id, e.name')
          .orderBy('"firstTimers"', 'DESC');
        if (hasRange)
          qb.where('ft.created_at BETWEEN :from AND :to', { from, to });
        return qb.getRawMany<{ eventName: string; firstTimers: string }>();
      })(),
    ]);

    const totalTasks = taskStatusRows.reduce(
      (sum, r) => sum + Number(r.count),
      0,
    );
    const joinedCount = Number(
      outcomeRows.find((r) => r.outcome === FollowUpOutcomeEnum.JOINED)
        ?.count ?? 0,
    );
    const conversionRate =
      totalTasks > 0
        ? `${((joinedCount / totalTasks) * 100).toFixed(1)}%`
        : '0%';

    const bySource: Record<string, number> = {};
    for (const row of sourceRows) bySource[row.source] = Number(row.count);

    const byStatus: Record<string, number> = {};
    for (const row of taskStatusRows) byStatus[row.status] = Number(row.count);

    const byOutcome: Record<string, number> = {};
    for (const row of outcomeRows) byOutcome[row.outcome] = Number(row.count);

    return {
      period: {
        from: from?.toISOString() ?? null,
        to: to?.toISOString() ?? null,
      },
      firstTimers: {
        total: Number(firstTimerRows?.total ?? 0),
        bySource,
        wantsToJoinChurch: Number(firstTimerRows?.wantsToJoinChurch ?? 0),
        wantsToJoinWorkforce: Number(firstTimerRows?.wantsToJoinWorkforce ?? 0),
      },
      tasks: {
        total: totalTasks,
        byStatus,
        byOutcome,
        overdue: Number(overdueResult?.count ?? 0),
        conversionRate,
      },
      byWorker: workerRows.map((r) => ({
        workerName: r.workerName,
        assigned: Number(r.assigned),
        completed: Number(r.completed),
        joined: Number(r.joined),
      })),
      byEvent: eventRows.map((r) => ({
        eventName: r.eventName,
        firstTimers: Number(r.firstTimers),
      })),
    };
  }

  async pickRoundRobinAssignee(): Promise<WorkerProfile | null> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select('wp.id', 'id')
      .addSelect(
        `COUNT(CASE WHEN ft.status IN ('PENDING','IN_PROGRESS') THEN 1 END)`,
        'openCount',
      )
      .from('worker_profiles', 'wp')
      .leftJoin('departments', 'd_primary', 'd_primary.id = wp.department_id')
      .leftJoin(
        'departments',
        'd_secondary',
        'd_secondary.id = wp.secondary_department_id',
      )
      .leftJoin('follow_up_tasks', 'ft', 'ft.assigned_to_id = wp.id')
      .where(
        '(:capability = ANY(d_primary.capabilities) OR :capability = ANY(d_secondary.capabilities))',
        { capability: DepartmentCapability.MANAGE_FOLLOW_UP },
      )
      .andWhere('wp.status = :status', { status: WorkerStatusEnum.ACTIVE })
      .groupBy('wp.id')
      .orderBy('"openCount"', 'ASC')
      .limit(1)
      .getRawMany<{ id: string; openCount: string }>();

    if (!rows.length) return null;
    return this.workerProfileRepo.findOne({
      where: { id: rows[0].id },
      relations: ['member'],
    });
  }

  // Backs the reassign-task picker — same active/dept-capability filter as
  // pickRoundRobinAssignee, unpaginated (small team).
  async getActiveFollowUpWorkers(): Promise<WorkerProfile[]> {
    return this.workerProfileRepo
      .createQueryBuilder('wp')
      .leftJoinAndSelect('wp.member', 'member')
      .leftJoinAndSelect('wp.department', 'd_primary')
      .leftJoinAndSelect('wp.secondaryDepartment', 'd_secondary')
      .where(
        '(:capability = ANY(d_primary.capabilities) OR :capability = ANY(d_secondary.capabilities))',
        { capability: DepartmentCapability.MANAGE_FOLLOW_UP },
      )
      .andWhere('wp.status = :status', { status: WorkerStatusEnum.ACTIVE })
      .orderBy('member.firstname', 'ASC')
      .getMany();
  }

  async assertWorkerInFollowUpDept(memberId: string): Promise<void> {
    await this.departmentAccessService.assertHasCapability(
      memberId,
      DepartmentCapability.MANAGE_FOLLOW_UP,
      'Access restricted to Follow-Up Management workers',
    );
  }

  private computeDueDate(): Date {
    const due = new Date();
    due.setDate(due.getDate() + this.followUpDueDays);
    return due;
  }

  private async isFollowUpWorker(profile: WorkerProfile): Promise<boolean> {
    const full = await this.workerProfileRepo.findOne({
      where: { id: profile.id },
      relations: ['department', 'secondaryDepartment'],
    });
    return (
      !!full?.department?.capabilities?.includes(
        DepartmentCapability.MANAGE_FOLLOW_UP,
      ) ||
      !!full?.secondaryDepartment?.capabilities?.includes(
        DepartmentCapability.MANAGE_FOLLOW_UP,
      )
    );
  }

  private async doCreateFirstTimer(
    dto: CreateFirstTimerDto,
    actor: { memberCreatorId?: string; adminCreatorId?: string },
  ): Promise<FirstTimer> {
    let assignee: WorkerProfile | null = null;
    const dueDate = this.computeDueDate();

    // Deliberately NOT this.dataSource.transaction() — that would open an
    // independent connection that never sees TenantMiddleware's SET LOCAL
    // search_path, so the raw SQL below (worker_profiles/departments/
    // follow_up_tasks, all tenant-schema tables) would run against the
    // wrong schema. this.txHost.tx is the ambient manager already inside
    // the one transaction the current request is running in.
    const manager = this.txHost.tx;
    // Serialize concurrent picks so round-robin is accurate under load
    await manager.query(
      `SELECT pg_advisory_xact_lock(hashtext('follow-up:round-robin'))`,
    );

    const rows: { id: string }[] = await manager.query(
      `SELECT wp.id
               FROM worker_profiles wp
               LEFT JOIN departments d_primary ON d_primary.id = wp.department_id
               LEFT JOIN departments d_secondary ON d_secondary.id = wp.secondary_department_id
               LEFT JOIN follow_up_tasks ft
                   ON ft.assigned_to_id = wp.id AND ft.status IN ('PENDING', 'IN_PROGRESS')
               WHERE ($1 = ANY(d_primary.capabilities) OR $1 = ANY(d_secondary.capabilities)) AND wp.status = $2
               GROUP BY wp.id
               ORDER BY COUNT(ft.id) ASC
               LIMIT 1`,
      [DepartmentCapability.MANAGE_FOLLOW_UP, WorkerStatusEnum.ACTIVE],
    );

    if (rows.length) {
      assignee = await manager.findOne(WorkerProfile, {
        where: { id: rows[0].id },
        relations: ['member'],
      });
    } else {
      this.logger.warn(
        'First-timer created with no active Follow-Up worker to assign',
      );
    }

    const firstTimer = manager.create(FirstTimer, {
      firstname: dto.firstname,
      lastname: dto.lastname,
      phone: dto.phone,
      email: dto.email ?? null,
      source: dto.source,
      wantsToJoinChurch: dto.wantsToJoinChurch ?? false,
      enjoyedAboutChurch: dto.enjoyedAboutChurch ?? null,
      wantsToJoinWorkforce: dto.wantsToJoinWorkforce ?? false,
      notes: dto.notes ?? null,
      visitedEvent: dto.visitedEventId ? { id: dto.visitedEventId } : null,
      createdByMember: actor.memberCreatorId
        ? { id: actor.memberCreatorId }
        : null,
      createdByAdmin: actor.adminCreatorId
        ? { id: actor.adminCreatorId }
        : null,
    });

    const ft = await manager.save(FirstTimer, firstTimer);

    await manager.save(
      manager.create(FollowUpTask, {
        type: FollowUpTaskTypeEnum.FIRST_TIMER,
        status: FollowUpTaskStatusEnum.PENDING,
        firstTimer: ft,
        assignedTo: assignee,
        dueDate,
      }),
    );

    if (assignee?.member?.email) {
      this.emailQueueService.queueEmailWithTemplate(
        assignee.member.email,
        `New Follow-Up Task Assigned — ${this.churchName}`,
        'follow-up-task-assigned',
        {
          workerName: assignee.member.firstname,
          firstTimerName: `${dto.firstname} ${dto.lastname}`,
          phone: dto.phone,
          email: dto.email ?? null,
          dueDate: dueDate.toDateString(),
          churchName: this.churchName,
        },
        undefined,
        EmailCategory.FOLLOW_UP,
      );
    }

    this.cacheService.flushNamespace('follow-up:report');
    ft.assignmentWarning = assignee
      ? null
      : 'No active Follow-Up worker was available, so this first-timer is unassigned. Reassign it once a worker is active.';
    return ft;
  }

  async inviteFirstTimerToMembership(id: string): Promise<{ queued: boolean }> {
    const ft = await this.firstTimerRepo.findOne({ where: { id } });
    if (!ft) throw new NotFoundException('First-timer not found');
    if (!ft.email)
      throw new BadRequestException(
        'This first-timer has no email address on record',
      );
    if (ft.inviteSentAt) return { queued: false };
    this.emailQueueService.queueEmailWithTemplate(
      ft.email,
      `You're Invited to Join ${this.churchName}`,
      'first-timer-membership-invite',
      {
        firstname: ft.firstname,
        lastname: ft.lastname,
      },
      undefined,
      EmailCategory.FOLLOW_UP,
    );
    ft.inviteSentAt = new Date();
    await this.firstTimerRepo.save(ft);
    this.logger.log(`Membership invitation queued for first-timer ${id}`);
    return { queued: true };
  }

  async markConverted(
    firstTimerId: string,
    memberId?: string,
  ): Promise<FirstTimer> {
    const ft = await this.firstTimerRepo.findOne({
      where: { id: firstTimerId },
    });
    if (!ft) throw new NotFoundException('First-timer not found');
    ft.convertedAt = new Date();
    ft.convertedMember = memberId ? ({ id: memberId } as any) : null;
    const saved = await this.firstTimerRepo.save(ft);
    this.cacheService.flushNamespace('follow-up:report');
    this.logger.log(
      `First-timer ${firstTimerId} marked as converted${memberId ? ` → member ${memberId}` : ''}`,
    );
    return saved;
  }

  async updateFirstTimerByWorker(
    id: string,
    dto: UpdateFirstTimerDto,
    memberId: string,
  ): Promise<FirstTimer> {
    await this.assertWorkerInFollowUpDept(memberId);
    return this.updateFirstTimer(id, dto);
  }

  async updateFirstTimer(
    id: string,
    dto: UpdateFirstTimerDto,
  ): Promise<FirstTimer> {
    const ft = await this.firstTimerRepo.findOne({
      where: { id },
      relations: ['visitedEvent'],
    });
    if (!ft) throw new NotFoundException('First-timer not found');

    if (dto.firstname !== undefined) ft.firstname = dto.firstname;
    if (dto.lastname !== undefined) ft.lastname = dto.lastname;
    if (dto.phone !== undefined) ft.phone = dto.phone;
    if (dto.email !== undefined) ft.email = dto.email;
    if (dto.wantsToJoinChurch !== undefined)
      ft.wantsToJoinChurch = dto.wantsToJoinChurch;
    if (dto.wantsToJoinWorkforce !== undefined)
      ft.wantsToJoinWorkforce = dto.wantsToJoinWorkforce;
    if (dto.enjoyedAboutChurch !== undefined)
      ft.enjoyedAboutChurch = dto.enjoyedAboutChurch;
    if (dto.notes !== undefined) ft.notes = dto.notes;
    if (dto.visitedEventId !== undefined)
      ft.visitedEvent = { id: dto.visitedEventId } as Event;

    await this.firstTimerRepo.save(ft);
    this.cacheService.flushNamespace('follow-up:report');
    this.logger.log(`First-timer ${id} updated`);
    const reloaded = await this.firstTimerRepo.findOne({
      where: { id },
      relations: ['visitedEvent'],
    });
    if (!reloaded) throw new NotFoundException('First-timer not found');
    return reloaded;
  }

  async adminUpdateTask(
    taskId: string,
    dto: AdminUpdateFollowUpTaskDto,
  ): Promise<FollowUpTask> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId },
      relations: ['notes'],
    });
    if (!task) throw new NotFoundException('Task not found');

    if (dto.status) task.status = dto.status;
    if (dto.outcome) task.outcome = dto.outcome;
    if (dto.outcomeNotes !== undefined) task.outcomeNotes = dto.outcomeNotes;
    if (dto.dueDate) task.dueDate = new Date(dto.dueDate);
    task.lastActivityAt = new Date();

    const saved = await this.taskRepo.save(task);
    this.logger.log(
      `Task ${taskId} updated by admin (status: ${saved.status})`,
    );

    if (dto.noteContent) {
      await this.noteRepo.save(
        this.noteRepo.create({
          task: saved,
          addedBy: null,
          content: dto.noteContent,
          contactMethod: dto.contactMethod ?? null,
        }),
      );
    }

    this.cacheService.flushNamespace('follow-up:report');
    return saved;
  }

  async addNote(
    taskId: string,
    workerId: string,
    dto: AddNoteDto,
  ): Promise<FollowUpNote> {
    await this.assertWorkerInFollowUpDept(workerId);

    const profile = await this.workerProfileRepo.findOne({
      where: { member: { id: workerId } },
    });
    if (!profile) throw new NotFoundException('Worker profile not found');

    const task = await this.taskRepo.findOne({
      where: { id: taskId, assignedTo: { id: profile.id } },
    });
    if (!task)
      throw new NotFoundException('Task not found or not assigned to you');

    const note = await this.noteRepo.save(
      this.noteRepo.create({
        task,
        addedBy: profile,
        content: dto.content,
        contactMethod: dto.contactMethod ?? null,
      }),
    );

    task.lastActivityAt = new Date();
    await this.taskRepo.save(task);

    return note;
  }

  async logReturnVisit(
    firstTimerId: string,
    dto: LogVisitDto,
  ): Promise<FirstTimerVisit> {
    const ft = await this.firstTimerRepo.findOne({
      where: { id: firstTimerId },
    });
    if (!ft) throw new NotFoundException('First-timer not found');

    const visit = await this.visitRepo.save(
      this.visitRepo.create({
        firstTimer: ft,
        event: dto.eventId ? ({ id: dto.eventId } as any) : null,
        visitedAt: dto.visitedAt ?? new Date().toISOString().split('T')[0],
        notes: dto.notes ?? null,
      }),
    );

    this.cacheService.flushNamespace('follow-up:report');
    this.logger.log(`Return visit logged for first-timer ${firstTimerId}`);
    return visit;
  }

  async getFirstTimerPipeline(
    from?: string,
    to?: string,
  ): Promise<{
    total: number;
    untouched: number;
    contacted: number;
    returned: number;
    invited: number;
    converted: number;
  }> {
    const params: (string | null)[] = [from ?? null, to ?? null];
    const [row] = await this.dataSource.query<
      {
        total: string;
        untouched: string;
        contacted: string;
        returned: string;
        invited: string;
        converted: string;
      }[]
    >(
      `SELECT
         COUNT(*)                                                          AS total,
         COUNT(*) FILTER (WHERE ft.converted_at IS NOT NULL)              AS converted,
         COUNT(*) FILTER (WHERE ft.invite_sent_at IS NOT NULL
                            AND ft.converted_at IS NULL)                  AS invited,
         COUNT(*) FILTER (WHERE COALESCE(v.cnt, 0) > 0
                            AND ft.invite_sent_at IS NULL
                            AND ft.converted_at IS NULL)                  AS returned,
         COUNT(*) FILTER (WHERE COALESCE(n.cnt, 0) > 0
                            AND COALESCE(v.cnt, 0) = 0
                            AND ft.invite_sent_at IS NULL
                            AND ft.converted_at IS NULL)                  AS contacted,
         COUNT(*) FILTER (WHERE COALESCE(n.cnt, 0) = 0
                            AND COALESCE(v.cnt, 0) = 0
                            AND ft.invite_sent_at IS NULL
                            AND ft.converted_at IS NULL)                  AS untouched
       FROM first_timers ft
       LEFT JOIN (
         SELECT first_timer_id, COUNT(*) AS cnt
         FROM first_timer_visits
         GROUP BY first_timer_id
       ) v ON v.first_timer_id = ft.id
       LEFT JOIN (
         SELECT fut.first_timer_id, COUNT(fn.id) AS cnt
         FROM follow_up_tasks fut
         LEFT JOIN follow_up_notes fn ON fn.task_id = fut.id
         WHERE fut.first_timer_id IS NOT NULL
         GROUP BY fut.first_timer_id
       ) n ON n.first_timer_id = ft.id
       WHERE ($1::timestamptz IS NULL OR ft.created_at >= $1)
         AND ($2::timestamptz IS NULL OR ft.created_at <= $2)`,
      params,
    );

    return {
      total: Number(row?.total ?? 0),
      converted: Number(row?.converted ?? 0),
      invited: Number(row?.invited ?? 0),
      returned: Number(row?.returned ?? 0),
      contacted: Number(row?.contacted ?? 0),
      untouched: Number(row?.untouched ?? 0),
    };
  }

  async getStaleTasks(
    daysInactive: number,
    page: number,
    limit: number,
  ): Promise<PaginationResponseDto<FollowUpTask>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysInactive);

    const [data, total] = await this.taskRepo
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.firstTimer', 'ft')
      .leftJoinAndSelect('task.assignedTo', 'wp')
      .leftJoinAndSelect('wp.member', 'm')
      .where('task.status IN (:...statuses)', { statuses: OPEN_STATUSES })
      .andWhere('task.lastActivityAt < :cutoff', { cutoff })
      .orderBy('task.lastActivityAt', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  // Used by MemberTimelineService for the pre-membership leg of a member's
  // timeline; null if they joined without ever being a FirstTimer.
  async getFirstTimerByConvertedMemberId(
    memberId: string,
  ): Promise<FirstTimer | null> {
    return this.firstTimerRepo.findOne({
      where: { convertedMember: { id: memberId } },
      relations: ['visits', 'visitedEvent'],
      order: { visits: { visitedAt: 'ASC' } },
    });
  }

  // Backs the "which event?" picker — defaults to today's events, falls
  // back to name search. Public/unauthenticated, so only id/name/eventDate.
  async getPublicEvents(search?: string): Promise<PublicEventOption[]> {
    const qb = this.eventRepo
      .createQueryBuilder('event')
      .select(['event.id', 'event.name', 'event.eventDate'])
      .limit(8);

    if (search?.trim()) {
      qb.where('event.name ILIKE :search', {
        search: `%${search.trim()}%`,
      }).orderBy('event.eventDate', 'DESC');
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      qb.where('event.eventDate <= :today', { today })
        .andWhere('event.endDate >= :today', { today })
        .orderBy('event.startTime', 'ASC');
    }

    return qb.getMany();
  }
}
