import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
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
import { ConfigService } from '@nestjs/config';

const PICKUP_CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PICKUP_CODE_LENGTH = 6;

@Injectable()
export class ChildrenChurchService {
  private readonly logger = new Logger(ChildrenChurchService.name);
  private readonly productName: string;

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
    private readonly configService: ConfigService,
    private readonly departmentAccessService: DepartmentAccessService,
  ) {
    this.productName = this.configService.get<string>('PRODUCT_NAME');
  }

  // ─── Age Groups ───────────────────────────────────────────────────────────

  async createAgeGroup(dto: CreateChildAgeGroupDto): Promise<ChildAgeGroup> {
    this.logger.log(`Creating child age group: ${dto.name}`);
    if (dto.minAgeMonths >= dto.maxAgeMonths) {
      throw new BadRequestException(
        'minAgeMonths must be less than maxAgeMonths',
      );
    }
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
    return this.ageGroupRepo.save(entity);
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
    const { ageGroup, classGroup } = await this.computeAgeGroup(
      dto.dateOfBirth,
    );
    const entity = this.childProfileRepo.create({
      firstname: dto.firstname,
      lastname: dto.lastname,
      dateOfBirth: dto.dateOfBirth,
      photoUrl: dto.photoUrl ?? null,
      specialNotes: dto.specialNotes ?? null,
      ageGroup,
      classGroup,
      registeredBy: dto.registeredByMemberId
        ? ({ id: dto.registeredByMemberId } as Member)
        : null,
    });
    return this.childProfileRepo.save(entity);
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
    if (dto.dateOfBirth !== undefined) {
      entity.dateOfBirth = dto.dateOfBirth;
      const { ageGroup, classGroup } = await this.computeAgeGroup(
        dto.dateOfBirth,
      );
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
        "CONCAT(child.firstname, ' ', child.lastname) ILIKE :name OR child.firstname ILIKE :name OR child.lastname ILIKE :name",
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

    // Snapshot current occupancy per class group
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
      const ageInMonths = this.computeAgeInMonths(child.dateOfBirth);

      const ageGroup =
        ageGroups.find(
          (ag) =>
            ag.minAgeMonths <= ageInMonths && ag.maxAgeMonths >= ageInMonths,
        ) ?? null;

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
    const entity = this.guardianRepo.create({
      child,
      fullName: dto.fullName,
      phoneNumber: dto.phoneNumber ?? null,
      email: dto.email ?? null,
      relationship: dto.relationship,
      photoUrl: dto.photoUrl ?? null,
      isAuthorizedPickup: dto.isAuthorizedPickup ?? true,
      member: dto.memberId ? ({ id: dto.memberId } as Member) : null,
    });
    return this.guardianRepo.save(entity);
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
    });
    return this.checkInRepo.save(entity);
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
      relations: ['serviceSlot', 'droppedOffBy', 'pickedUpBy', 'checkedInBy'],
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
  ): Promise<PaginationResponseDto<ChildCheckIn>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');
    const where: any = {};
    if (status) where.status = status;
    if (classGroupId) where.child = { classGroup: { id: classGroupId } };
    if (slotId) where.serviceSlot = { id: slotId };
    const [data, totalCount] = await this.checkInRepo.findAndCount({
      where,
      relations: [
        'child',
        'child.classGroup',
        'child.ageGroup',
        'droppedOffBy',
        'pickedUpBy',
        'checkedInBy',
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

  private computeAgeInMonths(dateOfBirth: string): number {
    const dob = new Date(dateOfBirth);
    const today = new Date();
    let months = (today.getFullYear() - dob.getFullYear()) * 12;
    months += today.getMonth() - dob.getMonth();
    if (today.getDate() < dob.getDate()) months--;
    return months;
  }

  private async computeAgeGroup(dateOfBirth: string): Promise<{
    ageGroup: ChildAgeGroup | null;
    classGroup: ChildClassGroup | null;
  }> {
    const ageInMonths = this.computeAgeInMonths(dateOfBirth);

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
          day: '2-digit',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(checkIn.checkoutTime)
      : 'Unknown';

    for (const guardian of child.guardians) {
      const email = (guardian as ChildGuardian).email ?? guardian.member?.email;
      if (!email) continue;
      this.utilityService.sendEmailWithTemplate(
        email,
        `${this.productName} Pickup Confirmation: ${childName}`,
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
