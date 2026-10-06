import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { Convert } from '../entity/convert.entity';
import { ConvertFollowUpLog } from '../entity/convert-follow-up-log.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { Member } from '../../member/entity/member.entity';
import { FirstTimer } from '../../follow-up/entity/first-timer.entity';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { WorkerStatusEnum } from '../../member/enums/worker-status.enum';
import {
  BulkReassignConvertsDto,
  ConvertListQueryDto,
  ConvertScope,
  CreateConvertDto,
  LinkConvertToMemberDto,
  LogFollowUpDto,
  ReassignConvertDto,
  UpdateConvertStatusDto,
} from '../dto/convert.dto';
import { ConvertStatusEnum } from '../enum/convert-status.enum';
import { DepartmentCapability } from '../../department/enums/department-capability.enum';
import { DepartmentAccessService } from '../../department/service/department-access.service';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { CacheService } from '../../utility/service/cache.service';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { MemberService } from '../../member/service/member.service';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { EvangelismSettingsService } from './evangelism-settings.service';
import {
  EVANGELISM_REPORT_NAMESPACE,
  OutreachService,
  toPersonSummary,
} from './outreach.service';

const CAPABILITY = DepartmentCapability.MANAGE_EVANGELISM_CONVERTS;
export const EXPORT_ROW_CAP = 5000;

export type ConvertRole = 'onboarder' | 'team' | 'assignee';

// Where the person is on the journey from outreach to church membership.
export type ConvertStage = 'MET' | 'FOLLOWED_UP' | 'WITH_FOLLOW_UP' | 'JOINED';

// Still Evangelism's to follow up: not a member yet and not handed to Follow-Up as a first-timer.
const OPEN_SQL = 'c.member_id IS NULL AND c.first_timer_id IS NULL';

export interface ConvertView extends Convert {
  daysSinceLastContact: number | null;
  isOverdue: boolean;
  stage: ConvertStage;
  myRoles?: ConvertRole[];
}

export interface ConvertFilters extends ConvertListQueryDto {
  scope?: ConvertScope;
  viewerId?: string;
}

@Injectable()
export class ConvertService {
  constructor(
    @InjectRepository(Convert)
    private readonly convertRepo: Repository<Convert>,
    @InjectRepository(ConvertFollowUpLog)
    private readonly followUpLogRepo: Repository<ConvertFollowUpLog>,
    @InjectRepository(WorkerProfile)
    private readonly workerProfileRepo: Repository<WorkerProfile>,
    @InjectRepository(FirstTimer)
    private readonly firstTimerRepo: Repository<FirstTimer>,
    private readonly memberService: MemberService,
    private readonly auditLogService: AuditLogService,
    private readonly departmentAccessService: DepartmentAccessService,
    private readonly outreachService: OutreachService,
    private readonly settingsService: EvangelismSettingsService,
    private readonly cacheService: CacheService,
    private readonly notificationDispatchService: NotificationDispatchService,
  ) {}

  async createConvert(
    dto: CreateConvertDto,
    currentUser: MemberAuth,
  ): Promise<Convert> {
    const onboarder = await this.memberService.getById(currentUser.id);

    let teamIds: string[] = [];
    if (dto.outreachId) {
      const ids = await this.outreachService.findTeamMemberIds(dto.outreachId);
      if (!ids) throw new NotFoundException('Outreach not found');
      if (!ids.includes(onboarder.id)) {
        throw new ForbiddenException(
          'You can only add converts to an outreach you are on',
        );
      }
      teamIds = ids.filter((id) => id !== onboarder.id);
    }

    if (dto.phone && !dto.allowDuplicate) {
      const existing = await this.convertRepo.findOne({
        where: { phone: dto.phone },
        order: { createdAt: 'DESC' },
      });
      if (existing) {
        throw new ConflictException({
          message: 'A convert with this phone number already exists',
          code: 'CONVERT_DUPLICATE',
          existing: {
            id: existing.id,
            name: existing.name,
            onboardedByName: existing.onboardedByName,
            createdAt: existing.createdAt,
          },
        });
      }
    }

    const { autoAssign } = await this.settingsService.get();
    const assignee = autoAssign
      ? await this.pickAssignee([onboarder.id, ...teamIds])
      : null;

    const saved = await this.convertRepo.save(
      this.convertRepo.create({
        name: dto.name,
        phone: dto.phone ?? null,
        notes: dto.notes ?? null,
        status: dto.status ?? ConvertStatusEnum.UNSAVED,
        onboardedBy: { id: onboarder.id } as Member,
        onboardedByName: `${onboarder.firstname} ${onboarder.lastname}`,
        outreach: dto.outreachId ? ({ id: dto.outreachId } as never) : null,
        assignedTo: assignee,
      }),
    );

    this.auditLogService.log('CONVERT_CREATED', {
      actorId: currentUser.id,
      targetId: saved.id,
      targetName: saved.name,
      metadata: {
        outreachId: dto.outreachId ?? null,
        assignedTo: assignee?.id ?? null,
      },
    });
    this.flushReport();
    if (assignee && assignee.member.id !== onboarder.id) {
      this.notifyAssigned([assignee.member.id], saved.name);
    }

    return saved;
  }

  async metAgain(
    convertId: string,
    dto: LogFollowUpDto,
    currentUser: MemberAuth,
  ): Promise<ConvertFollowUpLog> {
    const convert = await this.convertRepo.findOne({
      where: { id: convertId },
      relations: ['firstTimer'],
    });
    if (!convert) throw new NotFoundException('Convert not found');
    assertStillWithEvangelism(convert);
    const note = dto.note?.trim();
    return this.logFollowUp(
      convertId,
      { note: note ? `Met again: ${note}` : 'Met again on outreach' },
      currentUser,
    );
  }

  async logFollowUp(
    convertId: string,
    dto: LogFollowUpDto,
    currentUser: MemberAuth,
  ): Promise<ConvertFollowUpLog> {
    const convert = await this.convertRepo.findOne({
      where: { id: convertId },
    });
    if (!convert) throw new NotFoundException('Convert not found');

    const logger = await this.memberService.getById(currentUser.id);

    const log = this.followUpLogRepo.create({
      convert,
      loggedBy: { id: logger.id } as Member,
      loggedByName: `${logger.firstname} ${logger.lastname}`,
      note: dto.note ?? null,
    });
    const saved = await this.followUpLogRepo.save(log);

    convert.lastContactedAt = saved.contactedAt;
    await this.convertRepo.save(convert);

    this.auditLogService.log('CONVERT_FOLLOW_UP_LOGGED', {
      actorId: currentUser.id,
      targetId: saved.id,
      targetName: convert.name,
      metadata: { convertId },
    });
    this.flushReport();

    return saved;
  }

  async getFollowUpHistory(
    convertId: string,
    page = 1,
    limit = 10,
  ): Promise<PaginationResponseDto<ConvertFollowUpLog>> {
    const convertExists = await this.convertRepo.existsBy({ id: convertId });
    if (!convertExists) throw new NotFoundException('Convert not found');

    const [data, total] = await this.followUpLogRepo.findAndCount({
      where: { convert: { id: convertId } },
      order: { contactedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async listForMember(
    filters: ConvertListQueryDto & { scope?: ConvertScope },
    viewerId: string,
  ): Promise<PaginationResponseDto<ConvertView>> {
    const scope = filters.scope ?? 'mine';
    if (scope === 'team') await this.assertIsEvangelismDeptWorker(viewerId);
    return this.list({ ...filters, scope, viewerId });
  }

  async listForAdmin(
    filters: ConvertListQueryDto,
  ): Promise<PaginationResponseDto<ConvertView>> {
    if (filters.assignedTo === 'me') {
      throw new BadRequestException(
        "assignedTo=me isn't available in the admin portal",
      );
    }
    return this.list(filters, ['onboardedBy']);
  }

  async findForExport(filters: ConvertListQueryDto): Promise<ConvertView[]> {
    const page = await this.list(
      { ...filters, page: 1, limit: EXPORT_ROW_CAP },
      [],
    );
    return page.data;
  }

  private async list(
    filters: ConvertFilters,
    extraRelations: string[] = [],
  ): Promise<PaginationResponseDto<ConvertView>> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const { overdueDays } = await this.settingsService.get();
    const qb = this.buildConvertQuery(filters, overdueDays);

    const [idRows, countRow] = await Promise.all([
      qb
        .clone()
        .select('c.id', 'id')
        .addSelect('c.created_at', 'created_at')
        .distinct(true)
        .orderBy('c.created_at', 'DESC')
        .offset((page - 1) * limit)
        .limit(limit)
        .getRawMany<{ id: string }>(),
      qb
        .clone()
        .select('COUNT(DISTINCT c.id)', 'count')
        .getRawOne<{ count: string }>(),
    ]);
    const total = Number(countRow?.count ?? 0);
    const ids = idRows.map((r) => r.id);
    if (!ids.length) {
      return UtilityService.createPaginationResponse([], page, limit, total);
    }

    const rows = await this.convertRepo.find({
      where: { id: In(ids) },
      relations: [
        'outreach',
        'outreach.team',
        'assignedTo',
        'assignedTo.member',
        'member',
        'firstTimer',
        ...extraRelations,
      ],
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const data = ids
      .map((id) => byId.get(id))
      .filter((c): c is Convert => !!c)
      .map((c) => this.toView(c, overdueDays, filters.viewerId));
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  private buildConvertQuery(
    filters: ConvertFilters,
    overdueDays: number,
  ): SelectQueryBuilder<Convert> {
    const qb = this.convertRepo
      .createQueryBuilder('c')
      .leftJoin('c.outreach', 'o')
      .leftJoin('o.team', 'tm')
      .leftJoin('c.assignedTo', 'wp')
      .leftJoin('wp.member', 'am');

    if (filters.scope === 'mine') {
      qb.andWhere(
        '(c.onboarded_by = :viewer OR tm.id = :viewer OR am.id = :viewer)',
        { viewer: filters.viewerId },
      );
    }
    if (filters.status) {
      qb.andWhere('c.status = :status', { status: filters.status });
    }
    if (filters.assignedTo === 'unassigned') {
      qb.andWhere('c.assigned_to IS NULL');
    } else if (filters.assignedTo === 'me') {
      qb.andWhere('am.id = :viewer', { viewer: filters.viewerId });
    } else if (filters.assignedTo) {
      qb.andWhere('wp.id = :wpId', { wpId: filters.assignedTo });
    }
    if (filters.stage === 'with_follow_up') {
      qb.andWhere('c.first_timer_id IS NOT NULL AND c.member_id IS NULL');
    } else if (filters.stage === 'joined') {
      qb.andWhere('c.member_id IS NOT NULL');
    } else if (filters.stage === 'open') {
      qb.andWhere(OPEN_SQL);
    }
    if (filters.overdue) {
      qb.andWhere(
        `(${OPEN_SQL} AND (c.last_contacted_at IS NULL OR c.last_contacted_at < :cutoff))`,
        { cutoff: new Date(Date.now() - overdueDays * 86_400_000) },
      );
    }
    if (filters.outreachId) {
      qb.andWhere('c.outreach_id = :outreachId', {
        outreachId: filters.outreachId,
      });
    }
    if (filters.search?.trim()) {
      qb.andWhere('(c.name ILIKE :search OR c.phone ILIKE :search)', {
        search: `%${filters.search.trim()}%`,
      });
    }
    if (filters.from) {
      qb.andWhere('c.created_at >= :from', { from: new Date(filters.from) });
    }
    if (filters.to) {
      qb.andWhere('c.created_at <= :to', { to: endOfDay(filters.to) });
    }
    return qb;
  }

  private toView(
    c: Convert,
    overdueDays: number,
    viewerId?: string,
  ): ConvertView {
    const daysSinceLastContact = c.lastContactedAt
      ? Math.floor((Date.now() - c.lastContactedAt.getTime()) / 86_400_000)
      : null;
    const isOverdue =
      !c.member &&
      !c.firstTimer &&
      (daysSinceLastContact === null || daysSinceLastContact > overdueDays);

    const team = c.outreach?.team ?? [];
    const view: ConvertView = {
      ...c,
      outreach: c.outreach
        ? ({ ...c.outreach, team: team.map(toPersonSummary) } as never)
        : null,
      onboardedBy: c.onboardedBy
        ? (toPersonSummary(c.onboardedBy) as Member)
        : c.onboardedBy,
      firstTimer: c.firstTimer ? ({ id: c.firstTimer.id } as never) : null,
      daysSinceLastContact,
      isOverdue,
      stage: stageOf(c),
    };
    if (viewerId) {
      const roles: ConvertRole[] = [];
      if (c.onboardedBy?.id === viewerId) roles.push('onboarder');
      if (team.some((m) => m.id === viewerId)) roles.push('team');
      if (c.assignedTo?.member?.id === viewerId) roles.push('assignee');
      view.myRoles = roles;
    }
    return view;
  }

  async updateStatus(
    convertId: string,
    dto: UpdateConvertStatusDto,
    actorId: string,
  ): Promise<Convert> {
    const convert = await this.convertRepo.findOne({
      where: { id: convertId },
    });
    if (!convert) throw new NotFoundException('Convert not found');

    convert.status = dto.status;
    const saved = await this.convertRepo.save(convert);

    this.auditLogService.log('CONVERT_STATUS_UPDATED', {
      actorId,
      targetId: saved.id,
      targetName: saved.name,
      metadata: { status: dto.status },
    });
    this.flushReport();

    return saved;
  }

  async reassignConvert(
    convertId: string,
    dto: ReassignConvertDto,
    actorMemberId: string,
  ): Promise<Convert> {
    const [convert, target] = await Promise.all([
      this.convertRepo.findOne({
        where: { id: convertId },
        relations: ['firstTimer'],
      }),
      this.findActiveWorkerProfile(dto.workerProfileId),
    ]);
    if (!convert) throw new NotFoundException('Convert not found');
    assertStillWithEvangelism(convert);

    convert.assignedTo = target;
    const saved = await this.convertRepo.save(convert);

    this.auditLogService.log('CONVERT_REASSIGNED', {
      actorId: actorMemberId,
      targetId: saved.id,
      targetName: saved.name,
      metadata: { workerProfileId: dto.workerProfileId },
    });
    this.flushReport();
    if (target.member.id !== actorMemberId) {
      this.notifyAssigned([target.member.id], saved.name);
    }

    return saved;
  }

  async unassignConvert(
    convertId: string,
    actorMemberId: string,
  ): Promise<Convert> {
    const convert = await this.convertRepo.findOne({
      where: { id: convertId },
    });
    if (!convert) throw new NotFoundException('Convert not found');

    convert.assignedTo = null;
    const saved = await this.convertRepo.save(convert);

    this.auditLogService.log('CONVERT_UNASSIGNED', {
      actorId: actorMemberId,
      targetId: saved.id,
      targetName: saved.name,
    });
    this.flushReport();

    return saved;
  }

  async bulkReassign(
    dto: BulkReassignConvertsDto,
    actorMemberId: string,
  ): Promise<{ updated: number }> {
    const byIds = !!dto.convertIds?.length;
    if (byIds === !!dto.fromWorkerProfileId) {
      throw new BadRequestException(
        'Provide either convertIds or fromWorkerProfileId, not both',
      );
    }
    if (dto.fromWorkerProfileId === dto.toWorkerProfileId) {
      throw new BadRequestException(
        'Source and target worker must be different',
      );
    }
    const target = await this.findActiveWorkerProfile(dto.toWorkerProfileId);

    const qb = this.convertRepo
      .createQueryBuilder()
      .update(Convert)
      .set({ assignedTo: { id: target.id } as WorkerProfile });
    if (byIds) {
      qb.where('id IN (:...ids) AND first_timer_id IS NULL', {
        ids: dto.convertIds,
      });
    } else {
      qb.where(
        'assigned_to = :from AND member_id IS NULL AND first_timer_id IS NULL',
        { from: dto.fromWorkerProfileId },
      );
    }
    const result = await qb.execute();
    const updated = result.affected ?? 0;

    this.auditLogService.log('CONVERTS_BULK_REASSIGNED', {
      actorId: actorMemberId,
      targetId: target.id,
      targetName: `${target.member.firstname} ${target.member.lastname}`,
      metadata: {
        updated,
        convertIds: dto.convertIds ?? null,
        fromWorkerProfileId: dto.fromWorkerProfileId ?? null,
      },
    });
    this.flushReport();
    if (updated > 0 && target.member.id !== actorMemberId) {
      this.notificationDispatchService.notifyMember({
        category: EmailCategory.EVANGELISM,
        push: {
          memberIds: [target.member.id],
          key: PushNotificationKey.CONVERTS_BULK_ASSIGNED,
          vars: { count: updated },
          idempotencyKey: `converts-bulk-assigned:${target.id}:${Date.now()}`,
        },
      });
    }

    return { updated };
  }

  async moveToOutreach(
    convertId: string,
    outreachId: string | null,
    actorMemberId: string,
  ): Promise<Convert> {
    const convert = await this.convertRepo.findOne({
      where: { id: convertId },
    });
    if (!convert) throw new NotFoundException('Convert not found');
    if (outreachId && !(await this.outreachService.exists(outreachId))) {
      throw new NotFoundException('Outreach not found');
    }

    convert.outreach = outreachId ? ({ id: outreachId } as never) : null;
    const saved = await this.convertRepo.save(convert);

    this.auditLogService.log('CONVERT_OUTREACH_CHANGED', {
      actorId: actorMemberId,
      targetId: saved.id,
      targetName: saved.name,
      metadata: { outreachId },
    });
    this.flushReport();

    return saved;
  }

  async linkToMember(
    convertId: string,
    dto: LinkConvertToMemberDto,
    actorAdminId: string,
  ): Promise<Convert> {
    const convert = await this.convertRepo.findOne({
      where: { id: convertId },
      relations: ['firstTimer', 'firstTimer.convertedMember'],
    });
    if (!convert) throw new NotFoundException('Convert not found');

    convert.member = { id: dto.memberId } as Member;
    convert.linkedAt = new Date();
    const saved = await this.convertRepo.save(convert);

    // Joining is recorded once: the first-timer they became is closed too.
    const ft = convert.firstTimer;
    if (ft && !ft.convertedAt) {
      await this.firstTimerRepo.update(ft.id, {
        convertedAt: convert.linkedAt,
        convertedMember: { id: dto.memberId } as Member,
      });
      this.cacheService.flushNamespace('follow-up:report');
    }

    this.auditLogService.log('CONVERT_LINKED_TO_MEMBER', {
      actorId: actorAdminId,
      targetId: saved.id,
      targetName: saved.name,
      metadata: { memberId: dto.memberId },
    });
    this.flushReport();

    return saved;
  }

  // The Evangelism dept, or anyone who met the convert or now owns it; writes stop once Follow-Up takes over.
  async assertCanActOnConvert(
    convertId: string,
    memberId: string,
    { write }: { write: boolean } = { write: true },
  ): Promise<void> {
    const convert = await this.convertRepo.findOne({
      where: { id: convertId },
      relations: [
        'onboardedBy',
        'outreach',
        'outreach.team',
        'assignedTo',
        'assignedTo.member',
        'firstTimer',
      ],
    });
    if (!convert) throw new NotFoundException('Convert not found');
    if (write) assertStillWithEvangelism(convert);

    const isInvolved =
      convert.onboardedBy?.id === memberId ||
      convert.assignedTo?.member?.id === memberId ||
      !!convert.outreach?.team?.some((m) => m.id === memberId);
    if (isInvolved) return;

    await this.departmentAccessService.assertHasCapability(
      memberId,
      CAPABILITY,
      'Only the outreach team, the assigned worker, or the Evangelism department can act on this convert',
    );
  }

  async assertIsEvangelismDeptWorker(memberId: string): Promise<void> {
    await this.departmentAccessService.assertHasCapability(
      memberId,
      CAPABILITY,
      'Only Evangelism Convert Management workers can perform this action',
    );
  }

  // Someone who was there first, else the least-loaded Evangelism worker.
  async pickAssignee(memberIds: string[]): Promise<WorkerProfile | null> {
    const profiles = await this.workerProfileRepo.find({
      where: {
        member: { id: In(memberIds), status: MemberStatusEnum.ACTIVE },
        status: WorkerStatusEnum.ACTIVE,
      },
      relations: ['member', 'department', 'secondaryDepartment'],
    });
    for (const id of memberIds) {
      const profile = profiles.find((p) => p.member?.id === id);
      if (profile && hasCapability(profile)) return profile;
    }

    const rows = await this.workerProfileRepo
      .createQueryBuilder('wp')
      .select('wp.id', 'id')
      .addSelect(`COUNT(c.id) FILTER (WHERE ${OPEN_SQL})`, 'openCount')
      .innerJoin('wp.member', 'm')
      .leftJoin('wp.department', 'd')
      .leftJoin('wp.secondaryDepartment', 'sd')
      .leftJoin('converts', 'c', 'c.assigned_to = wp.id')
      .where('(:cap = ANY(d.capabilities) OR :cap = ANY(sd.capabilities))', {
        cap: CAPABILITY,
      })
      .andWhere('wp.status = :wpStatus', { wpStatus: WorkerStatusEnum.ACTIVE })
      .andWhere('m.status = :mStatus', { mStatus: MemberStatusEnum.ACTIVE })
      .groupBy('wp.id')
      .orderBy('"openCount"', 'ASC')
      .addOrderBy('wp.id', 'ASC')
      .limit(1)
      .getRawMany<{ id: string }>();
    if (!rows.length) return null;
    return this.workerProfileRepo.findOne({
      where: { id: rows[0].id },
      relations: ['member'],
    });
  }

  private async findActiveWorkerProfile(id: string): Promise<WorkerProfile> {
    const profile = await this.workerProfileRepo.findOne({
      where: { id },
      relations: ['member'],
    });
    if (!profile) throw new NotFoundException('Worker profile not found');
    if (
      profile.status !== WorkerStatusEnum.ACTIVE ||
      profile.member?.status !== MemberStatusEnum.ACTIVE
    ) {
      throw new BadRequestException('Target worker must be active');
    }
    return profile;
  }

  private notifyAssigned(memberIds: string[], convertName: string): void {
    this.notificationDispatchService.notifyMember({
      category: EmailCategory.EVANGELISM,
      push: {
        memberIds,
        key: PushNotificationKey.CONVERT_ASSIGNED,
        vars: { convert_name: convertName },
        idempotencyKey: `convert-assigned:${memberIds.join(',')}:${Date.now()}`,
      },
    });
  }

  private flushReport(): void {
    this.cacheService.flushNamespace(EVANGELISM_REPORT_NAMESPACE);
  }
}

function stageOf(c: Convert): ConvertStage {
  if (c.member) return 'JOINED';
  if (c.firstTimer) return 'WITH_FOLLOW_UP';
  if (c.lastContactedAt) return 'FOLLOWED_UP';
  return 'MET';
}

function assertStillWithEvangelism(c: Convert): void {
  if (c.firstTimer) {
    throw new ConflictException(
      'This convert visited church and is now being followed up by the Follow-Up team as a first-timer',
    );
  }
}

const hasCapability = (p: WorkerProfile) =>
  !!p.department?.capabilities?.includes(CAPABILITY) ||
  !!p.secondaryDepartment?.capabilities?.includes(CAPABILITY);

const endOfDay = (iso: string) =>
  iso.length <= 10 ? new Date(`${iso}T23:59:59.999Z`) : new Date(iso);
