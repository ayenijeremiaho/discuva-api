import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { ChildAgeGroup } from '../entity/child-age-group.entity';
import { ChildClassGroup } from '../entity/child-class-group.entity';
import { ChildProfile } from '../entity/child-profile.entity';
import { ChildGuardian } from '../entity/child-guardian.entity';
import { ChildCheckIn } from '../entity/child-check-in.entity';
import { ChildCheckInStatusEnum } from '../enums/child-checkin-status.enum';
import {
  CreateChildAgeGroupDto,
  UpdateChildAgeGroupDto,
} from '../dto/create-age-group.dto';
import {
  CreateChildClassGroupDto,
  UpdateChildClassGroupDto,
} from '../dto/create-class-group.dto';
import {
  CreateChildProfileDto,
  UpdateChildProfileDto,
} from '../dto/create-child-profile.dto';
import { CreateGuardianDto } from '../dto/create-guardian.dto';
import { ChildCheckInDto } from '../dto/child-check-in.dto';
import { ChildCheckOutDto } from '../dto/child-check-out.dto';
import { FlagCheckInDto } from '../dto/flag-check-in.dto';
import { Member } from '../../member/entity/member.entity';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { DepartmentCapability } from '../../department/enums/department-capability.enum';
import { DepartmentAccessService } from '../../department/service/department-access.service';
import { UtilityService } from '../../utility/service/utility.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { randomBytes } from 'node:crypto';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { childAgeInMonths, monthsRange } from '../child-age.util';
import { MemberService } from '../../member/service/member.service';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { buildJobEnvelope } from '../../tenant/utility/job-envelope';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import {
  CHILDREN_LATE_QUEUE,
  LATE_PICKUP_MINUTES,
} from '../children-church.constants';

const PICKUP_CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PICKUP_CODE_LENGTH = 6;

@Injectable()
export class ChildrenChurchService {
  private readonly logger = new Logger(ChildrenChurchService.name);

  constructor(
    @InjectRepository(ChildAgeGroup)
    private readonly ageGroupRepo: Repository<ChildAgeGroup>,
    @InjectRepository(ChildClassGroup)
    private readonly classGroupRepo: Repository<ChildClassGroup>,
    @InjectRepository(ChildProfile)
    private readonly childProfileRepo: Repository<ChildProfile>,
    @InjectRepository(ChildGuardian)
    private readonly guardianRepo: Repository<ChildGuardian>,
    @InjectRepository(ChildCheckIn)
    private readonly checkInRepo: Repository<ChildCheckIn>,
    private readonly utilityService: UtilityService,
    private readonly departmentAccessService: DepartmentAccessService,
    private readonly churchTimezone: ChurchTimezoneService,
    private readonly memberService: MemberService,
    @InjectRepository(ServiceSlot)
    private readonly slotRepo: Repository<ServiceSlot>,
    @InjectQueue(CHILDREN_LATE_QUEUE) private readonly lateQueue: Queue,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  // ─── Age Groups ───────────────────────────────────────────────────────────

  async createAgeGroup(dto: CreateChildAgeGroupDto): Promise<ChildAgeGroup> {
    this.logger.log(`Creating child age group: ${dto.name}`);
    if (dto.minAgeMonths >= dto.maxAgeMonths) {
      throw new BadRequestException(
        'minAgeMonths must be less than maxAgeMonths',
      );
    }
    await this.assertNoOverlap(dto.minAgeMonths, dto.maxAgeMonths);
    const entity = this.ageGroupRepo.create({
      name: dto.name,
      minAgeMonths: dto.minAgeMonths,
      maxAgeMonths: dto.maxAgeMonths,
      displayOrder: dto.displayOrder ?? 0,
    });
    return this.ageGroupRepo.save(entity);
  }

  async updateAgeGroup(
    id: string,
    dto: UpdateChildAgeGroupDto,
  ): Promise<ChildAgeGroup> {
    this.logger.log(`Updating child age group ${id}`);
    const entity = await this.ageGroupRepo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException('Age group not found');
    if (dto.name !== undefined) entity.name = dto.name;
    if (dto.minAgeMonths !== undefined) entity.minAgeMonths = dto.minAgeMonths;
    if (dto.maxAgeMonths !== undefined) entity.maxAgeMonths = dto.maxAgeMonths;
    if (dto.displayOrder !== undefined) entity.displayOrder = dto.displayOrder;
    const min = dto.minAgeMonths ?? entity.minAgeMonths;
    const max = dto.maxAgeMonths ?? entity.maxAgeMonths;
    if (min >= max)
      throw new BadRequestException(
        'minAgeMonths must be less than maxAgeMonths',
      );
    if (dto.minAgeMonths !== undefined || dto.maxAgeMonths !== undefined)
      await this.assertNoOverlap(min, max, id);
    return this.ageGroupRepo.save(entity);
  }

  // A child of any age must land in exactly one group.
  private async assertNoOverlap(
    min: number,
    max: number,
    exceptId?: string,
  ): Promise<void> {
    const clash = await this.ageGroupRepo.findOne({
      where: {
        minAgeMonths: LessThanOrEqual(max),
        maxAgeMonths: MoreThanOrEqual(min),
        ...(exceptId ? { id: Not(exceptId) } : {}),
      },
      select: { id: true, name: true },
    });
    if (clash) {
      throw new BadRequestException(
        `These ages overlap with ${clash.name}. Change one so each age fits one group.`,
      );
    }
  }

  async deleteAgeGroup(id: string): Promise<void> {
    this.logger.log(`Deleting child age group ${id}`);
    const entity = await this.ageGroupRepo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException('Age group not found');

    // Deleting an age group cascades to all its class groups.
    // Children directly in the age group or assigned to any of its class groups
    // would become unassigned — block this to prevent silent data loss.
    const childCount = await this.childProfileRepo.count({
      where: [{ ageGroup: { id } }, { classGroup: { ageGroup: { id } } }],
    });
    if (childCount > 0) {
      throw new BadRequestException(
        `Cannot delete this age group — ${childCount} child profile(s) are assigned to it or its class groups. Reassign or remove them first.`,
      );
    }

    await this.ageGroupRepo.remove(entity);
  }

  async getAllAgeGroups(): Promise<ChildAgeGroup[]> {
    return this.ageGroupRepo.find({
      order: { displayOrder: 'ASC', minAgeMonths: 'ASC' },
    });
  }

  // ─── Class Groups ─────────────────────────────────────────────────────────

  async createClassGroup(
    dto: CreateChildClassGroupDto,
  ): Promise<ChildClassGroup> {
    this.logger.log(
      `Creating class group "${dto.name}" in age group ${dto.ageGroupId}`,
    );
    const ageGroup = await this.ageGroupRepo.findOne({
      where: { id: dto.ageGroupId },
    });
    if (!ageGroup) throw new NotFoundException('Age group not found');
    const entity = this.classGroupRepo.create({
      ageGroup,
      name: dto.name,
      capacity: dto.capacity ?? null,
      teacherNote: dto.teacherNote ?? null,
      childrenPerTeacher: dto.childrenPerTeacher ?? null,
    });
    return this.classGroupRepo.save(entity);
  }

  async updateClassGroup(
    id: string,
    dto: UpdateChildClassGroupDto,
  ): Promise<ChildClassGroup> {
    this.logger.log(`Updating class group ${id}`);
    const entity = await this.classGroupRepo.findOne({
      where: { id },
      relations: ['ageGroup'],
    });
    if (!entity) throw new NotFoundException('Class group not found');
    if (dto.name !== undefined) entity.name = dto.name;
    if (dto.capacity !== undefined) entity.capacity = dto.capacity ?? null;
    if (dto.teacherNote !== undefined)
      entity.teacherNote = dto.teacherNote ?? null;
    if (dto.childrenPerTeacher !== undefined)
      entity.childrenPerTeacher = dto.childrenPerTeacher ?? null;
    return this.classGroupRepo.save(entity);
  }

  async deleteClassGroup(id: string): Promise<void> {
    this.logger.log(`Deleting class group ${id}`);
    const entity = await this.classGroupRepo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException('Class group not found');

    const childCount = await this.childProfileRepo.count({
      where: { classGroup: { id } },
    });
    if (childCount > 0) {
      throw new BadRequestException(
        `Cannot delete this class group — ${childCount} child profile(s) are assigned to it. Reassign or remove them first.`,
      );
    }

    await this.classGroupRepo.remove(entity);
  }

  async getClassGroupsByAgeGroup(
    ageGroupId: string,
  ): Promise<ChildClassGroup[]> {
    return this.classGroupRepo.find({
      where: { ageGroup: { id: ageGroupId } },
      order: { name: 'ASC' },
    });
  }

  // ─── Child Profiles ───────────────────────────────────────────────────────

  async registerChild(
    user: MemberAuth,
    dto: CreateChildProfileDto,
  ): Promise<ChildProfile> {
    await this.requireChildrenChurchAuth(user);
    this.logger.log(`Registering child: ${dto.firstname} ${dto.lastname}`);
    const age = this.ageFields(await this.withGroupRange(dto));
    const guardians = this.uniqueGuardians(dto.guardians ?? []);
    const { ageGroup, classGroup } = await this.computeAgeGroup(age);
    return this.childProfileRepo.manager.transaction(async (m) => {
      const child = await m.save(
        ChildProfile,
        this.childProfileRepo.create({
          firstname: dto.firstname,
          lastname: dto.lastname,
          ...age,
          photoUrl: dto.photoUrl ?? null,
          specialNotes: dto.specialNotes ?? null,
          ageGroup,
          classGroup,
          registeredBy: dto.registeredByMemberId
            ? ({ id: dto.registeredByMemberId } as Member)
            : null,
        }),
      );
      if (guardians.length) {
        child.guardians = await m.save(
          ChildGuardian,
          guardians.map((g) => this.guardianEntity(child, g)),
        );
      }
      return child;
    });
  }

  async updateChild(
    user: MemberAuth,
    id: string,
    dto: UpdateChildProfileDto,
  ): Promise<ChildProfile> {
    await this.requireChildrenChurchAuth(user);
    this.logger.log(`Updating child profile ${id}`);
    const entity = await this.childProfileRepo.findOne({
      where: { id },
      relations: ['ageGroup', 'classGroup'],
    });
    if (!entity) throw new NotFoundException('Child not found');
    if (dto.firstname !== undefined) entity.firstname = dto.firstname;
    if (dto.lastname !== undefined) entity.lastname = dto.lastname;
    if (dto.photoUrl !== undefined) entity.photoUrl = dto.photoUrl ?? null;
    if (dto.specialNotes !== undefined)
      entity.specialNotes = dto.specialNotes ?? null;
    if (
      dto.dateOfBirth !== undefined ||
      dto.ageRange !== undefined ||
      dto.ageGroupId !== undefined
    ) {
      Object.assign(entity, this.ageFields(await this.withGroupRange(dto)));
      const { ageGroup, classGroup } = await this.computeAgeGroup(entity);
      entity.ageGroup = ageGroup;
      entity.classGroup = classGroup;
    }
    return this.childProfileRepo.save(entity);
  }

  async getChild(user: MemberAuth, id: string): Promise<ChildProfile> {
    await this.requireChildrenChurchAuth(user);
    const entity = await this.childProfileRepo.findOne({
      where: { id },
      relations: ['ageGroup', 'classGroup', 'guardians', 'registeredBy'],
    });
    if (!entity) throw new NotFoundException('Child not found');
    entity.visitCount = await this.checkInRepo.count({
      where: { child: { id } },
    });
    return entity;
  }

  async searchChildren(
    user: MemberAuth,
    name?: string,
    page = 1,
    limit = 20,
    classGroupId?: string,
  ): Promise<PaginationResponseDto<ChildProfile>> {
    await this.requireChildrenChurchAuth(user);
    const qb = this.childProfileRepo
      .createQueryBuilder('child')
      .leftJoinAndSelect('child.ageGroup', 'ageGroup')
      .leftJoinAndSelect('child.classGroup', 'classGroup')
      .orderBy('child.lastname', 'ASC')
      .addOrderBy('child.firstname', 'ASC');

    if (name) {
      qb.where(
        "(CONCAT(child.firstname, ' ', child.lastname) ILIKE :name OR child.firstname ILIKE :name OR child.lastname ILIKE :name)",
        { name: `%${name}%` },
      );
    }

    if (classGroupId) {
      qb.andWhere('classGroup.id = :classGroupId', { classGroupId });
    }

    const [data, totalCount] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data,
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Recomputes age group and class group assignments for all children.
   *
   * Designed to be run once a year (e.g., at the start of a new church year) or whenever
   * age group boundaries change. It pre-loads all reference data in 3 queries, classifies
   * every child in memory, and batch-saves only the children whose assignment changed —
   * making it efficient even for congregations with 1,000+ children.
   */
  async batchRecomputeAgeGroups(): Promise<{ updated: number }> {
    this.logger.log('Batch recomputing age groups for all children');

    const [ageGroups, classGroups, children] = await Promise.all([
      this.ageGroupRepo.find({
        order: { displayOrder: 'ASC', minAgeMonths: 'ASC' },
      }),
      this.classGroupRepo.find({ relations: ['ageGroup'] }),
      this.childProfileRepo.find({ relations: ['ageGroup', 'classGroup'] }),
    ]);

    if (!children.length) return { updated: 0 };

    const occupancy = new Map<string, number>(
      classGroups.map((cg) => [cg.id, 0]),
    );
    for (const child of children) {
      if (child.classGroup) {
        occupancy.set(
          child.classGroup.id,
          (occupancy.get(child.classGroup.id) ?? 0) + 1,
        );
      }
    }

    // Index class groups by age group id for O(1) lookup
    const classesByAgeGroup = new Map<string, ChildClassGroup[]>();
    for (const cg of classGroups) {
      const list = classesByAgeGroup.get(cg.ageGroup.id) ?? [];
      list.push(cg);
      classesByAgeGroup.set(cg.ageGroup.id, list);
    }

    const toUpdate: ChildProfile[] = [];

    for (const child of children) {
      const ageInMonths = childAgeInMonths(child);

      const ageGroup =
        ageInMonths === null
          ? null
          : (ageGroups.find(
              (ag) =>
                ag.minAgeMonths <= ageInMonths &&
                ag.maxAgeMonths >= ageInMonths,
            ) ?? null);

      let classGroup: ChildClassGroup | null = null;
      if (ageGroup) {
        const candidates = classesByAgeGroup.get(ageGroup.id) ?? [];
        if (candidates.length) {
          classGroup = candidates.reduce((min, cg) =>
            (occupancy.get(cg.id) ?? 0) < (occupancy.get(min.id) ?? 0)
              ? cg
              : min,
          );
          // Adjust occupancy snapshot when the assignment changes
          if (child.classGroup?.id !== classGroup.id) {
            occupancy.set(
              classGroup.id,
              (occupancy.get(classGroup.id) ?? 0) + 1,
            );
            if (child.classGroup?.id) {
              occupancy.set(
                child.classGroup.id,
                Math.max(0, (occupancy.get(child.classGroup.id) ?? 0) - 1),
              );
            }
          }
        }
      }

      const sameAgeGroup = child.ageGroup?.id === ageGroup?.id;
      const sameClassGroup = child.classGroup?.id === classGroup?.id;

      if (!sameAgeGroup || !sameClassGroup) {
        child.ageGroup = ageGroup;
        child.classGroup = classGroup;
        toUpdate.push(child);
      }
    }

    if (toUpdate.length > 0) {
      await this.childProfileRepo.save(toUpdate);
    }

    return { updated: toUpdate.length };
  }

  // ─── Guardians ────────────────────────────────────────────────────────────

  async addGuardian(
    user: MemberAuth,
    childId: string,
    dto: CreateGuardianDto,
  ): Promise<ChildGuardian> {
    await this.requireChildrenChurchAuth(user);
    this.logger.log(`Adding guardian for child ${childId}`);
    const child = await this.childProfileRepo.findOne({
      where: { id: childId },
    });
    if (!child) throw new NotFoundException('Child not found');
    if (dto.memberId) {
      const already = await this.guardianRepo.exists({
        where: { child: { id: childId }, member: { id: dto.memberId } },
      });
      if (already) {
        throw new BadRequestException(
          'This member is already a guardian of this child',
        );
      }
    }
    return this.guardianRepo.save(this.guardianEntity(child, dto));
  }

  // Children the signed-in member is a guardian of. Other guardians' contact details are left out.
  async getMyChildren(user: MemberAuth) {
    const children = await this.childProfileRepo
      .createQueryBuilder('child')
      .innerJoin('child.guardians', 'mine', 'mine.member_id = :me', {
        me: user.id,
      })
      .leftJoinAndSelect('child.ageGroup', 'ageGroup')
      .leftJoinAndSelect('child.classGroup', 'classGroup')
      .leftJoin('child.guardians', 'g')
      .addSelect([
        'g.id',
        'g.fullName',
        'g.relationship',
        'g.isAuthorizedPickup',
      ])
      .orderBy('child.firstname', 'ASC')
      .getMany();
    if (!children.length) return [];
    const status = await this.checkInRepo
      .createQueryBuilder('ci')
      .select('ci.child_id', 'childId')
      .addSelect('MAX(ci.checkin_time)', 'lastVisit')
      .addSelect(`BOOL_OR(ci.status = :status)`, 'inClassNow')
      .where('ci.child_id IN (:...ids)', { ids: children.map((c) => c.id) })
      .setParameter('status', ChildCheckInStatusEnum.CHECKED_IN)
      .groupBy('ci.child_id')
      .getRawMany<{ childId: string; lastVisit: Date; inClassNow: boolean }>();
    const byChild = new Map(status.map((r) => [r.childId, r]));
    return children.map((c) => ({
      ...c,
      inClassNow: !!byChild.get(c.id)?.inClassNow,
      lastVisit: byChild.get(c.id)?.lastVisit ?? null,
    }));
  }

  async getMyChildCheckInHistory(
    user: MemberAuth,
    childId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginationResponseDto<ChildCheckIn>> {
    const isGuardian = await this.guardianRepo.exists({
      where: { child: { id: childId }, member: { id: user.id } },
    });
    if (!isGuardian) throw new NotFoundException('Child not found');
    const [data, totalCount] = await this.checkInRepo
      .createQueryBuilder('ci')
      .leftJoin('ci.serviceSlot', 'slot')
      .addSelect(['slot.id', 'slot.name'])
      .leftJoin('ci.checkedInBy', 'tin')
      .addSelect(['tin.id', 'tin.firstname', 'tin.lastname'])
      .leftJoin('ci.checkedOutBy', 'tout')
      .addSelect(['tout.id', 'tout.firstname', 'tout.lastname'])
      .where('ci.child_id = :childId', { childId })
      .orderBy('ci.checkinTime', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return {
      data,
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async searchMembersForGuardian(user: MemberAuth, q: string) {
    await this.requireChildrenChurchAuth(user);
    return this.memberService.searchActiveMembersLite(q);
  }

  async linkGuardian(
    user: MemberAuth,
    guardianId: string,
    memberId: string | null,
  ): Promise<ChildGuardian> {
    await this.requireChildrenChurchAuth(user);
    const guardian = await this.guardianRepo.findOne({
      where: { id: guardianId },
      relations: ['child'],
    });
    if (!guardian) throw new NotFoundException('Guardian not found');
    if (memberId) {
      const taken = await this.guardianRepo.exists({
        where: { child: { id: guardian.child.id }, member: { id: memberId } },
      });
      if (taken) {
        throw new BadRequestException(
          'This member is already a guardian of this child',
        );
      }
    }
    guardian.member = memberId ? ({ id: memberId } as Member) : null;
    return this.guardianRepo.save(guardian);
  }

  async removeGuardian(user: MemberAuth, guardianId: string): Promise<void> {
    await this.requireChildrenChurchAuth(user);
    this.logger.log(`Removing guardian ${guardianId}`);
    const entity = await this.guardianRepo.findOne({
      where: { id: guardianId },
    });
    if (!entity) throw new NotFoundException('Guardian not found');
    await this.guardianRepo.remove(entity);
  }

  async getChildGuardians(
    user: MemberAuth,
    childId: string,
  ): Promise<ChildGuardian[]> {
    await this.requireChildrenChurchAuth(user);
    const child = await this.childProfileRepo.findOne({
      where: { id: childId },
    });
    if (!child) throw new NotFoundException('Child not found');
    return this.guardianRepo.find({
      where: { child: { id: childId } },
      relations: ['member'],
      order: { createdAt: 'ASC' },
    });
  }

  // ─── Check-In / Check-Out ─────────────────────────────────────────────────

  async checkIn(user: MemberAuth, dto: ChildCheckInDto): Promise<ChildCheckIn> {
    await this.requireChildrenChurchAuth(user);
    this.logger.log(`Checking in child ${dto.childId}`);
    const child = await this.childProfileRepo.findOne({
      where: { id: dto.childId },
      relations: ['classGroup', 'ageGroup'],
    });
    if (!child) throw new NotFoundException('Child not found');

    const activeCheckIn = await this.checkInRepo.findOne({
      where: {
        child: { id: dto.childId },
        status: ChildCheckInStatusEnum.CHECKED_IN,
      },
    });
    if (activeCheckIn) {
      throw new BadRequestException(
        'This child is already checked in for this service.',
      );
    }

    const pickupCode = await this.generateUniquePickupCode();
    const staying = dto.stayingAllServices ?? child.staysAllServices;

    const entity = this.checkInRepo.create({
      child,
      serviceSlot: dto.serviceSlotId
        ? ({ id: dto.serviceSlotId } as any)
        : null,
      droppedOffBy: dto.droppedOffByGuardianId
        ? ({ id: dto.droppedOffByGuardianId } as ChildGuardian)
        : null,
      droppedOffByName: dto.droppedOffByName ?? null,
      checkedInBy: { id: user.id } as Member,
      checkinTime: new Date(),
      pickupCode,
      status: ChildCheckInStatusEnum.CHECKED_IN,
      stayingAllServices: staying,
    });
    const saved = await this.checkInRepo.save(entity);
    if (staying !== child.staysAllServices) {
      this.childProfileRepo
        .update(child.id, { staysAllServices: staying })
        .catch((err) =>
          this.logger.error(`Staying choice not kept: ${err.message}`),
        );
    }
    if (dto.serviceSlotId) {
      this.schedulePickupReminders(dto.serviceSlotId, staying).catch((err) =>
        this.logger.error(`Late pickup job not scheduled: ${err.message}`),
      );
    }
    return saved;
  }

  async setStaying(checkInId: string, staying: boolean) {
    const ci = await this.checkInRepo.findOne({
      where: { id: checkInId, status: ChildCheckInStatusEnum.CHECKED_IN },
      relations: ['child', 'serviceSlot'],
      select: { id: true, child: { id: true }, serviceSlot: { id: true } },
    });
    if (!ci) throw new NotFoundException('This child is not checked in');
    await Promise.all([
      this.checkInRepo.update(ci.id, { stayingAllServices: staying }),
      this.childProfileRepo.update(ci.child.id, { staysAllServices: staying }),
    ]);
    if (ci.serviceSlot) {
      this.schedulePickupReminders(ci.serviceSlot.id, staying).catch((err) =>
        this.logger.error(`Late pickup job not scheduled: ${err.message}`),
      );
    }
    return { id: ci.id, stayingAllServices: staying };
  }

  // Children staying for every service are reminded after the event's last service, not this one.
  private async schedulePickupReminders(
    slotId: string,
    staying: boolean,
  ): Promise<void> {
    await this.scheduleLatePickup(slotId);
    if (!staying) return;
    const last = await this.slotRepo
      .createQueryBuilder('s')
      .select(['s.id', 's.endTime'])
      .where(
        's.event_id = (SELECT x.event_id FROM service_slots x WHERE x.id = :slotId)',
        { slotId },
      )
      .orderBy('s.endTime', 'DESC')
      .limit(1)
      .getOne();
    if (last && last.id !== slotId) await this.scheduleLatePickup(last.id);
  }

  // One delayed job per service slot; the fixed jobId means later check-ins don't add more.
  private async scheduleLatePickup(slotId: string): Promise<void> {
    const slot = await this.slotRepo.findOne({
      where: { id: slotId },
      select: { id: true, endTime: true },
    });
    if (!slot?.endTime) return;
    const runAt =
      new Date(slot.endTime).getTime() + LATE_PICKUP_MINUTES * 60_000;
    const delay = runAt - Date.now();
    if (delay <= 0) return;
    const envelope = buildJobEnvelope(this.cls);
    await this.lateQueue.add(
      'late-pickup',
      { slotId, ...envelope },
      {
        jobId: `cc-late:${envelope.tenantId}:${slotId}`,
        delay,
        attempts: 2,
        removeOnComplete: true,
      },
    );
  }

  async verifyPickupCode(
    user: MemberAuth,
    code: string,
  ): Promise<ChildCheckIn> {
    await this.requireChildrenChurchAuth(user);
    const checkIn = await this.checkInRepo.findOne({
      where: {
        pickupCode: code.toUpperCase(),
        status: ChildCheckInStatusEnum.CHECKED_IN,
      },
      relations: [
        'child',
        'child.classGroup',
        'child.ageGroup',
        'child.guardians',
        'droppedOffBy',
        'checkedInBy',
      ],
    });
    if (!checkIn)
      throw new NotFoundException(
        'This pickup code is invalid or has expired. Please verify and try again.',
      );
    return checkIn;
  }

  async checkOut(
    user: MemberAuth,
    dto: ChildCheckOutDto,
  ): Promise<ChildCheckIn> {
    await this.requireChildrenChurchAuth(user);
    this.logger.log(`Processing checkout with code ${dto.pickupCode}`);
    const checkIn = await this.checkInRepo.findOne({
      where: {
        pickupCode: dto.pickupCode.toUpperCase(),
        status: ChildCheckInStatusEnum.CHECKED_IN,
      },
      relations: ['child'],
    });
    if (!checkIn)
      throw new NotFoundException(
        'This pickup code is invalid or has already been used.',
      );

    checkIn.status = ChildCheckInStatusEnum.CHECKED_OUT;
    checkIn.checkoutTime = new Date();
    checkIn.pickedUpBy = dto.pickedUpByGuardianId
      ? ({ id: dto.pickedUpByGuardianId } as ChildGuardian)
      : null;
    checkIn.pickedUpByName = dto.pickedUpByName ?? null;
    checkIn.checkedOutBy = { id: user.id } as Member;

    const saved = await this.checkInRepo.save(checkIn);

    // Fire-and-forget pickup notification to all guardians with an email
    this.sendPickupNotification(saved).catch((err) =>
      this.logger.error(
        `Failed to send pickup notification for check-in ${saved.id}: ${err.message}`,
      ),
    );

    return saved;
  }

  async flagCheckIn(
    user: MemberAuth,
    checkInId: string,
    dto: FlagCheckInDto,
  ): Promise<ChildCheckIn> {
    await this.requireChildrenChurchAuth(user);
    this.logger.log(`Flagging check-in ${checkInId}`);
    const checkIn = await this.checkInRepo.findOne({
      where: { id: checkInId },
    });
    if (!checkIn) throw new NotFoundException('Check-in record not found');
    checkIn.status = ChildCheckInStatusEnum.FLAGGED;
    checkIn.flagReason = dto.reason;
    return this.checkInRepo.save(checkIn);
  }

  async getActiveCheckIns(
    user: MemberAuth,
    classGroupId?: string,
  ): Promise<ChildCheckIn[]> {
    await this.requireChildrenChurchAuth(user);
    const where: any = { status: ChildCheckInStatusEnum.CHECKED_IN };
    if (classGroupId) {
      where.child = { classGroup: { id: classGroupId } };
    }
    return this.checkInRepo.find({
      where,
      relations: [
        'child',
        'child.classGroup',
        'child.ageGroup',
        'droppedOffBy',
        'serviceSlot',
        'checkedInBy',
      ],
      order: { checkinTime: 'ASC' },
    });
  }

  async getCheckInsBySlot(
    slotId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginationResponseDto<ChildCheckIn>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');
    const [checkIns, total] = await this.checkInRepo.findAndCount({
      where: { serviceSlot: { id: slotId } },
      relations: [
        'child',
        'child.classGroup',
        'child.ageGroup',
        'droppedOffBy',
        'pickedUpBy',
        'checkedInBy',
      ],
      order: { checkinTime: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(
      checkIns,
      page,
      limit,
      total,
    );
  }

  async getChildCheckInHistory(
    user: MemberAuth,
    childId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginationResponseDto<ChildCheckIn>> {
    await this.requireChildrenChurchAuth(user);
    const child = await this.childProfileRepo.findOne({
      where: { id: childId },
    });
    if (!child) throw new NotFoundException('Child not found');
    const [data, totalCount] = await this.checkInRepo.findAndCount({
      where: { child: { id: childId } },
      relations: [
        'serviceSlot',
        'droppedOffBy',
        'pickedUpBy',
        'checkedInBy',
        'checkedOutBy',
      ],
      order: { checkinTime: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data,
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getActiveCheckInsAdmin(classGroupId?: string): Promise<ChildCheckIn[]> {
    const where: any = { status: ChildCheckInStatusEnum.CHECKED_IN };
    if (classGroupId) {
      where.child = { classGroup: { id: classGroupId } };
    }
    return this.checkInRepo.find({
      where,
      relations: [
        'child',
        'child.classGroup',
        'child.ageGroup',
        'droppedOffBy',
        'serviceSlot',
        'checkedInBy',
      ],
      order: { checkinTime: 'ASC' },
    });
  }

  async getCheckInHistoryAdmin(
    page = 1,
    limit = 20,
    classGroupId?: string,
    status?: ChildCheckInStatusEnum,
    slotId?: string,
    teacherId?: string,
  ): Promise<PaginationResponseDto<ChildCheckIn>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');
    const base: any = {};
    if (status) base.status = status;
    if (classGroupId) base.child = { classGroup: { id: classGroupId } };
    if (slotId) base.serviceSlot = { id: slotId };
    const where = teacherId
      ? [
          { ...base, checkedInBy: { id: teacherId } },
          { ...base, checkedOutBy: { id: teacherId } },
        ]
      : base;
    const [data, totalCount] = await this.checkInRepo.findAndCount({
      where,
      relations: [
        'child',
        'child.classGroup',
        'child.ageGroup',
        'droppedOffBy',
        'pickedUpBy',
        'checkedInBy',
        'checkedOutBy',
        'serviceSlot',
      ],
      order: { checkinTime: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(
      data,
      page,
      limit,
      totalCount,
    );
  }

  // ─── Authorization Helpers ────────────────────────────────────────────────

  private async requireChildrenChurchAuth(user: MemberAuth): Promise<void> {
    await this.departmentAccessService.assertHasCapability(
      user.id,
      DepartmentCapability.MANAGE_CHILDREN_CHURCH,
      "Only Children's Church Management workers are authorized to perform this action.",
    );
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  guardianEntity(child: ChildProfile, dto: CreateGuardianDto): ChildGuardian {
    return this.guardianRepo.create({
      child,
      fullName: dto.fullName,
      phoneNumber: dto.phoneNumber ?? null,
      email: dto.email ?? null,
      relationship: dto.relationship,
      photoUrl: dto.photoUrl ?? null,
      isAuthorizedPickup: dto.isAuthorizedPickup ?? true,
      member: dto.memberId ? ({ id: dto.memberId } as Member) : null,
    });
  }

  private uniqueGuardians(list: CreateGuardianDto[]): CreateGuardianDto[] {
    const seen = new Set<string>();
    return list.filter((g) => {
      if (!g.memberId) return true;
      if (seen.has(g.memberId)) return false;
      seen.add(g.memberId);
      return true;
    });
  }

  // A chosen church age group becomes its month range, so the child ages out of it like any other.
  private async withGroupRange<
    T extends { dateOfBirth?: string; ageRange?: string; ageGroupId?: string },
  >(dto: T): Promise<T> {
    if (dto.dateOfBirth || !dto.ageGroupId) return dto;
    const group = await this.ageGroupRepo.findOne({
      where: { id: dto.ageGroupId },
      select: { id: true, minAgeMonths: true, maxAgeMonths: true },
    });
    if (!group) throw new NotFoundException('Age group not found');
    return {
      ...dto,
      ageRange: monthsRange(group.minAgeMonths, group.maxAgeMonths),
    };
  }

  // Exactly one of date of birth or age range is kept; a date of birth wins if both are sent.
  ageFields(dto: {
    dateOfBirth?: string;
    ageRange?: string;
  }): Pick<ChildProfile, 'dateOfBirth' | 'ageRange' | 'ageRangeSetOn'> {
    if (dto.dateOfBirth) {
      return {
        dateOfBirth: dto.dateOfBirth,
        ageRange: null,
        ageRangeSetOn: null,
      };
    }
    if (dto.ageRange) {
      return {
        dateOfBirth: null,
        ageRange: dto.ageRange,
        ageRangeSetOn: new Date().toISOString().slice(0, 10),
      };
    }
    throw new BadRequestException('Give a date of birth or an age range');
  }

  async computeAgeGroup(
    child: Pick<ChildProfile, 'dateOfBirth' | 'ageRange' | 'ageRangeSetOn'>,
  ): Promise<{
    ageGroup: ChildAgeGroup | null;
    classGroup: ChildClassGroup | null;
  }> {
    const ageInMonths = childAgeInMonths(child);
    if (ageInMonths === null) return { ageGroup: null, classGroup: null };

    const ageGroup = await this.ageGroupRepo.findOne({
      where: {
        minAgeMonths: LessThanOrEqual(ageInMonths),
        maxAgeMonths: MoreThanOrEqual(ageInMonths),
      },
      order: { displayOrder: 'ASC' },
    });

    if (!ageGroup) return { ageGroup: null, classGroup: null };

    const classGroups = await this.classGroupRepo.find({
      where: { ageGroup: { id: ageGroup.id } },
    });
    if (!classGroups.length) return { ageGroup, classGroup: null };

    const counts = await Promise.all(
      classGroups.map(async (cg) => ({
        classGroup: cg,
        count: await this.childProfileRepo.count({
          where: { classGroup: { id: cg.id } },
        }),
      })),
    );
    const leastLoaded = counts.sort((a, b) => a.count - b.count)[0].classGroup;
    return { ageGroup, classGroup: leastLoaded };
  }

  private generateCode(): string {
    return Array.from(
      { length: PICKUP_CODE_LENGTH },
      () => PICKUP_CODE_CHARSET[randomBytes(1)[0] % PICKUP_CODE_CHARSET.length],
    ).join('');
  }

  private async generateUniquePickupCode(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = this.generateCode();
      const exists = await this.checkInRepo.existsBy({ pickupCode: code });
      if (!exists) return code;
    }
    throw new Error('Failed to generate a unique pickup code — please retry');
  }

  private async sendPickupNotification(checkIn: ChildCheckIn): Promise<void> {
    const child = await this.childProfileRepo.findOne({
      where: { id: checkIn.child.id },
      relations: ['guardians', 'guardians.member', 'classGroup'],
    });
    if (!child || !child.guardians?.length) return;

    const childName = `${child.firstname} ${child.lastname}`;
    const pickedUpBy = checkIn.pickedUpByName ?? 'Not recorded';
    const classGroupName = child.classGroup?.name ?? 'Children Church';
    const checkoutTimeStr = checkIn.checkoutTime
      ? new Intl.DateTimeFormat('en-GB', {
          timeZone: await this.churchTimezone.get(),
          day: '2-digit',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(checkIn.checkoutTime)
      : 'Unknown';

    const churchName = await this.utilityService.resolveChurchName();
    for (const guardian of child.guardians) {
      const email = (guardian as ChildGuardian).email ?? guardian.member?.email;
      if (!email) continue;
      this.utilityService.sendEmailWithTemplate(
        email,
        `${churchName} Pickup Confirmation: ${childName}`,
        'child-pickup',
        {
          guardianName: guardian.fullName,
          childName,
          pickedUpBy,
          checkoutTime: checkoutTimeStr,
          classGroup: classGroupName,
        },
        undefined,
        EmailCategory.CHILDREN_CHURCH,
      );
    }
  }
}
