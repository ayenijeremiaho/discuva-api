import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import { CacheService } from '../utility/service/cache.service';
import { AuditLogService } from '../utility/service/audit-log.service';
import { Admin } from '../admin/entity/admin.entity';
import { Member } from '../member/entity/member.entity';
import { MemberRoleEnum } from '../member/enums/member-role.enum';
import { MemberStatusEnum } from '../member/enums/member-status.enum';
import { Venue } from '../venue/entity/venue.entity';
import { VenueService } from '../venue/service/venue.service';
import {
  Campus,
  CampusAdmin,
  CampusMoveStatus,
  MemberCampusMove,
  WorkerCampusMoveRequest,
} from './campus.entity';
import {
  CampusMovesQueryDto,
  CreateCampusDto,
  UpdateCampusDto,
} from './campus.dto';
import { CampusNotifier } from './campus-notifier.service';
import { CAMPUSES_NEEDED_TO_CHOOSE } from './campus.constant';

const CACHE_KEY = 'campuses:active';
const CACHE_TTL_SECONDS = 300;

export interface CampusChoice {
  id: string;
  name: string;
}

type Deciding = Pick<Admin, 'id' | 'isOwner'> & { member?: { id: string } };

@Injectable()
export class CampusService {
  constructor(
    @InjectRepository(Campus)
    private readonly campusRepo: Repository<Campus>,
    @InjectRepository(MemberCampusMove)
    private readonly moveRepo: Repository<MemberCampusMove>,
    @InjectRepository(WorkerCampusMoveRequest)
    private readonly requestRepo: Repository<WorkerCampusMoveRequest>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    @InjectRepository(CampusAdmin)
    private readonly campusAdminRepo: Repository<CampusAdmin>,
    private readonly cacheService: CacheService,
    private readonly auditLogService: AuditLogService,
    private readonly notifier: CampusNotifier,
  ) {}

  private async active(): Promise<CampusChoice[]> {
    const cached = await this.cacheService.get<CampusChoice[]>(CACHE_KEY);
    if (cached) return cached;
    const rows = await this.campusRepo.find({
      select: { id: true, name: true },
      where: { isActive: true },
      order: { name: 'ASC' },
    });
    const choices = rows.map(({ id, name }) => ({ id, name }));
    this.cacheService.set(CACHE_KEY, choices, CACHE_TTL_SECONDS);
    return choices;
  }

  // For sign-up and the member app: empty until the church has 2+ active campuses.
  async publicChoices(): Promise<CampusChoice[]> {
    const campuses = await this.active();
    return campuses.length >= CAMPUSES_NEEDED_TO_CHOOSE ? campuses : [];
  }

  async forMember(memberId: string) {
    const campuses = await this.publicChoices();
    if (!campuses.length) return { enabled: false, campuses };
    const [member, pending] = await Promise.all([
      this.memberRepo.findOne({
        select: { id: true, homeCampusId: true },
        where: { id: memberId },
      }),
      this.requestRepo.findOne({
        select: { id: true, toCampusId: true },
        where: { memberId, status: CampusMoveStatus.PENDING },
      }),
    ]);
    return {
      enabled: true,
      campuses,
      myCampusId: member?.homeCampusId ?? null,
      pendingMoveTo: pending?.toCampusId ?? null,
    };
  }

  // Members move themselves. Workers wait for approval, because rotas depend on them.
  async moveMyself(memberId: string, campusId: string) {
    const campuses = await this.publicChoices();
    const to = campuses.find((c) => c.id === campusId);
    if (!to)
      throw new BadRequestException('Choose one of the active campuses.');
    const member = await this.memberRepo.findOne({
      select: { id: true, homeCampusId: true, role: true },
      where: { id: memberId },
    });
    if (!member) throw new NotFoundException('Member not found.');
    if (member.homeCampusId === campusId) {
      await this.requestRepo.delete({
        memberId,
        status: CampusMoveStatus.PENDING,
      });
      return { status: 'unchanged' as const };
    }
    // Choosing a first campus changes no rota, so only a real move needs approval.
    if (member.role === MemberRoleEnum.WORKER && member.homeCampusId) {
      const requestId = await this.requestMove(
        memberId,
        member.homeCampusId,
        campusId,
      );
      const from = await this.campusRepo.findOne({
        select: { id: true, name: true },
        where: { id: member.homeCampusId },
      });
      await this.notifier.moveRequested({
        requestId,
        memberId,
        fromCampus: from,
        toCampus: to,
      });
      return { status: 'requested' as const };
    }
    await this.memberRepo.manager.transaction((tx) =>
      this.applyMove(tx, memberId, member.homeCampusId, campusId),
    );
    return { status: 'moved' as const };
  }

  private async requestMove(
    memberId: string,
    fromCampusId: string,
    toCampusId: string,
  ): Promise<string> {
    return this.requestRepo.manager.transaction(async (tx) => {
      await tx.delete(WorkerCampusMoveRequest, {
        memberId,
        status: CampusMoveStatus.PENDING,
      });
      const saved = await tx.save(
        tx.create(WorkerCampusMoveRequest, {
          memberId,
          fromCampusId,
          toCampusId,
        }),
      );
      return saved.id;
    });
  }

  private async applyMove(
    tx: EntityManager,
    memberId: string,
    fromCampusId: string | null,
    toCampusId: string,
  ): Promise<void> {
    await tx.update(Member, memberId, { homeCampusId: toCampusId });
    await tx.save(
      tx.create(MemberCampusMove, { memberId, fromCampusId, toCampusId }),
    );
  }

  // Campuses an admin looks after; none means the whole church.
  async scopeOf(adminId: string): Promise<string[]> {
    const rows = await this.campusAdminRepo.find({
      select: { campusId: true },
      where: { adminId },
    });
    return rows.map((r) => r.campusId);
  }

  private async canActFor(admin: Deciding, campusId: string | null) {
    if (admin.isOwner) return true;
    const scope = await this.scopeOf(admin.id);
    return !scope.length || (!!campusId && scope.includes(campusId));
  }

  async listForAdmin() {
    const [campuses, counts, venueCounts, links, pendingRequests, unassigned] =
      await Promise.all([
        this.campusRepo.find({ order: { isActive: 'DESC', name: 'ASC' } }),
        this.memberRepo
          .createQueryBuilder('m')
          .select('m.homeCampusId', 'campusId')
          .addSelect('COUNT(*)', 'count')
          .where('m.homeCampusId IS NOT NULL')
          .andWhere('m.status = :active', { active: MemberStatusEnum.ACTIVE })
          .groupBy('m.homeCampusId')
          .getRawMany<{ campusId: string; count: string }>(),
        this.campusRepo.manager
          .createQueryBuilder(Venue, 'v')
          .select('v.campusId', 'campusId')
          .addSelect('COUNT(*)', 'count')
          .where('v.campusId IS NOT NULL')
          .groupBy('v.campusId')
          .getRawMany<{ campusId: string; count: string }>(),
        this.campusAdminRepo.find({
          relations: { admin: { member: true } },
          select: {
            campusId: true,
            adminId: true,
            admin: {
              id: true,
              member: { id: true, firstname: true, lastname: true },
            },
          },
        }),
        this.requestRepo.count({ where: { status: CampusMoveStatus.PENDING } }),
        this.memberRepo.count({
          where: { homeCampusId: IsNull(), status: MemberStatusEnum.ACTIVE },
        }),
      ]);
    const members = new Map(counts.map((c) => [c.campusId, Number(c.count)]));
    const venues = new Map(
      venueCounts.map((c) => [c.campusId, Number(c.count)]),
    );
    const choosingOn =
      campuses.filter((c) => c.isActive).length >= CAMPUSES_NEEDED_TO_CHOOSE;
    return {
      choosingOn,
      pendingRequests,
      // Only worth flagging once members can choose.
      withoutCampus: choosingOn ? unassigned : 0,
      campuses: campuses.map((c) => ({
        id: c.id,
        name: c.name,
        isActive: c.isActive,
        members: members.get(c.id) ?? 0,
        venues: venues.get(c.id) ?? 0,
        admins: links
          .filter((l) => l.campusId === c.id && l.admin?.member)
          .map((l) => ({
            id: l.adminId,
            name: `${l.admin.member.firstname} ${l.admin.member.lastname}`,
          })),
      })),
    };
  }

  async create(dto: CreateCampusDto, actorId?: string): Promise<Campus> {
    const name = dto.name.trim();
    await this.assertNameFree(name);
    const campus = await this.campusRepo.manager.transaction(async (tx) => {
      const others = await this.openCampuses(tx);
      const created = await tx.save(tx.create(Campus, { name }));
      await this.adoptIfChoosingStarts(tx, others);
      return created;
    });
    this.cacheService.del(CACHE_KEY);
    this.auditLogService.log('CAMPUS_CREATED', {
      actorId,
      targetId: campus.id,
      metadata: { name },
    });
    return campus;
  }

  private openCampuses(tx: EntityManager) {
    return tx.find(Campus, {
      where: { isActive: true },
      order: { createdAt: 'ASC' },
    });
  }

  // Opening the second campus turns choosing on, so everyone without one belongs to the first.
  private async adoptIfChoosingStarts(tx: EntityManager, openBefore: Campus[]) {
    if (openBefore.length !== CAMPUSES_NEEDED_TO_CHOOSE - 1) return;
    const campusId = openBefore[0].id;
    await tx.update(
      Member,
      { homeCampusId: IsNull() },
      { homeCampusId: campusId },
    );
    await tx.update(Venue, { campusId: IsNull() }, { campusId });
  }

  private async assertNameFree(name: string, exceptId?: string) {
    const clash = await this.campusRepo
      .createQueryBuilder('c')
      .where('LOWER(c.name) = LOWER(:name)', { name })
      .andWhere(exceptId ? 'c.id != :exceptId' : '1=1', { exceptId })
      .getExists();
    if (clash) throw new ConflictException('A campus has this name already.');
  }

  async update(id: string, dto: UpdateCampusDto, actorId?: string) {
    const campus = await this.campusRepo.findOneBy({ id });
    if (!campus) throw new NotFoundException('Campus not found.');
    if (dto.name) {
      await this.assertNameFree(dto.name.trim(), id);
      campus.name = dto.name.trim();
    }
    await this.campusRepo.manager.transaction(async (tx) => {
      if (dto.isActive === false && campus.isActive) {
        await this.closeCampus(tx, campus, dto.moveMembersTo);
      }
      if (dto.isActive === true && !campus.isActive) {
        await this.adoptIfChoosingStarts(tx, await this.openCampuses(tx));
        campus.isActive = true;
      }
      await tx.save(campus);
    });
    this.cacheService.del(CACHE_KEY);
    this.auditLogService.log('CAMPUS_UPDATED', {
      actorId,
      targetId: id,
      metadata: { ...dto },
    });
    return campus;
  }

  // Nobody is left without a campus: anyone still here moves with a recorded move each.
  private async closeCampus(
    tx: EntityManager,
    campus: Campus,
    moveMembersTo?: string,
  ): Promise<void> {
    const members = await tx.find(Member, {
      select: { id: true },
      where: { homeCampusId: campus.id },
    });
    if (members.length) {
      if (!moveMembersTo) {
        throw new BadRequestException(
          `Choose where this campus's ${members.length} members should go first.`,
        );
      }
      const target = await tx.findOneBy(Campus, {
        id: moveMembersTo,
        isActive: true,
      });
      if (!target || target.id === campus.id) {
        throw new BadRequestException('Choose another active campus.');
      }
      await tx.update(
        Member,
        { homeCampusId: campus.id },
        { homeCampusId: target.id },
      );
      await tx.insert(
        MemberCampusMove,
        members.map((m) => ({
          memberId: m.id,
          fromCampusId: campus.id,
          toCampusId: target.id,
        })),
      );
      // The close just took these workers where they asked to go.
      await tx.delete(WorkerCampusMoveRequest, {
        fromCampusId: campus.id,
        toCampusId: target.id,
        status: CampusMoveStatus.PENDING,
      });
    }
    await tx.delete(WorkerCampusMoveRequest, {
      toCampusId: campus.id,
      status: CampusMoveStatus.PENDING,
    });
    campus.isActive = false;
  }

  async setVenues(id: string, venueIds: string[]) {
    if (!(await this.campusRepo.existsBy({ id }))) {
      throw new NotFoundException('Campus not found.');
    }
    await this.campusRepo.manager.transaction(async (tx) => {
      await tx.update(Venue, { campusId: id }, { campusId: null });
      if (venueIds.length) {
        await tx.update(Venue, { id: In(venueIds) }, { campusId: id });
      }
    });
    this.cacheService.del(VenueService.CACHE_KEY);
    return { venueIds };
  }

  async setAdmins(id: string, adminIds: string[], actorId?: string) {
    if (!(await this.campusRepo.existsBy({ id }))) {
      throw new NotFoundException('Campus not found.');
    }
    const unique = [...new Set(adminIds)];
    if (unique.length) {
      const found = await this.campusRepo.manager.count(Admin, {
        where: { id: In(unique), isActive: true },
      });
      if (found !== unique.length) {
        throw new BadRequestException('Choose active admins only.');
      }
    }
    await this.campusAdminRepo.manager.transaction(async (tx) => {
      await tx.delete(CampusAdmin, { campusId: id });
      if (unique.length) {
        await tx.insert(
          CampusAdmin,
          unique.map((adminId) => ({ campusId: id, adminId })),
        );
      }
    });
    this.auditLogService.log('CAMPUS_ADMINS_SET', {
      actorId,
      targetId: id,
      metadata: { adminIds: unique },
    });
    return { adminIds: unique };
  }

  // An admin's own move of a member counts as approved; it replaces any request they had.
  async moveMember(memberId: string, campusId: string, admin: Deciding) {
    const campuses = await this.publicChoices();
    if (!campuses.some((c) => c.id === campusId)) {
      throw new BadRequestException('Choose one of the active campuses.');
    }
    const member = await this.memberRepo.findOne({
      select: { id: true, homeCampusId: true },
      where: { id: memberId },
    });
    if (!member) throw new NotFoundException('Member not found.');
    if (!(await this.canActFor(admin, member.homeCampusId))) {
      throw new ForbiddenException(
        "Only this member's campus admins can move them.",
      );
    }
    if (member.homeCampusId === campusId)
      return { status: 'unchanged' as const };
    await this.memberRepo.manager.transaction(async (tx) => {
      await tx.delete(WorkerCampusMoveRequest, {
        memberId,
        status: CampusMoveStatus.PENDING,
      });
      await this.applyMove(tx, memberId, member.homeCampusId, campusId);
    });
    this.auditLogService.log('CAMPUS_MEMBER_MOVED', {
      actorId: admin.member?.id,
      targetId: memberId,
      metadata: { from: member.homeCampusId, to: campusId },
    });
    return { status: 'moved' as const };
  }

  async moves(query: CampusMovesQueryDto) {
    const qb = this.moveRepo
      .createQueryBuilder('move')
      .leftJoin('move.member', 'member')
      .leftJoin('move.fromCampus', 'fromCampus')
      .leftJoin('move.toCampus', 'toCampus')
      .select([
        'move.id',
        'move.createdAt',
        'member.id',
        'member.firstname',
        'member.lastname',
        'fromCampus.id',
        'fromCampus.name',
        'toCampus.id',
        'toCampus.name',
      ])
      .orderBy('move.createdAt', 'DESC')
      // Every join is many-to-one, so plain OFFSET/LIMIT is safe and skips TypeORM's DISTINCT pass.
      .offset((query.page - 1) * query.limit)
      .limit(query.limit);
    if (query.campusId) {
      if (query.direction === 'joined') {
        qb.where('move.toCampusId = :campusId', query);
      } else if (query.direction === 'left') {
        qb.where('move.fromCampusId = :campusId', query);
      } else {
        qb.where(
          '(move.toCampusId = :campusId OR move.fromCampusId = :campusId)',
          query,
        );
      }
    }
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page: query.page, limit: query.limit };
  }

  async moveRequests(admin: Deciding) {
    const [requests, scope] = await Promise.all([
      this.requestRepo.find({
        where: { status: CampusMoveStatus.PENDING },
        relations: { member: true, fromCampus: true, toCampus: true },
        select: {
          id: true,
          createdAt: true,
          fromCampusId: true,
          member: { id: true, firstname: true, lastname: true },
          fromCampus: { id: true, name: true },
          toCampus: { id: true, name: true },
        },
        order: { createdAt: 'ASC' },
      }),
      admin.isOwner ? Promise.resolve([]) : this.scopeOf(admin.id),
    ]);
    return requests.map((r) => ({
      ...r,
      canDecide:
        r.member?.id !== admin.member?.id &&
        (!scope.length || (!!r.fromCampusId && scope.includes(r.fromCampusId))),
    }));
  }

  async decideRequest(
    id: string,
    approve: boolean,
    admin: Deciding,
  ): Promise<{ status: CampusMoveStatus }> {
    const request = await this.requestRepo.findOne({
      where: { id },
      relations: { fromCampus: true, toCampus: true },
    });
    if (!request) throw new NotFoundException('Request not found.');
    if (request.status !== CampusMoveStatus.PENDING) {
      throw new ConflictException('This request has already been decided.');
    }
    const deciderMemberId = admin.member?.id ?? null;
    if (request.memberId === deciderMemberId) {
      throw new ForbiddenException('Someone else needs to decide your move.');
    }
    if (!(await this.canActFor(admin, request.fromCampusId))) {
      throw new ForbiddenException(
        `Only ${request.fromCampus?.name ?? 'their campus'}'s admins can decide this move.`,
      );
    }
    const status = approve
      ? CampusMoveStatus.APPROVED
      : CampusMoveStatus.DECLINED;
    await this.requestRepo.manager.transaction(async (tx) => {
      await tx.update(WorkerCampusMoveRequest, id, {
        status,
        decidedByMemberId: deciderMemberId,
        decidedAt: new Date(),
      });
      if (approve) {
        const member = await tx.findOneOrFail(Member, {
          select: { id: true, homeCampusId: true },
          where: { id: request.memberId },
        });
        if (member.homeCampusId !== request.toCampusId) {
          await this.applyMove(
            tx,
            request.memberId,
            member.homeCampusId,
            request.toCampusId,
          );
        }
      }
    });
    this.auditLogService.log('CAMPUS_MOVE_DECIDED', {
      actorId: deciderMemberId ?? undefined,
      targetId: request.memberId,
      metadata: { requestId: id, status },
    });
    await this.notifier.moveDecided(
      {
        requestId: id,
        memberId: request.memberId,
        fromCampus: request.fromCampus
          ? { id: request.fromCampus.id, name: request.fromCampus.name }
          : null,
        toCampus: { id: request.toCampus.id, name: request.toCampus.name },
      },
      approve,
    );
    return { status };
  }
}
