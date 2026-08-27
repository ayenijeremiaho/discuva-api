import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ChurchClass } from '../entity/church-class.entity';
import { ClassEnrollment } from '../entity/class-enrollment.entity';
import { ClassType } from '../entity/class-type.entity';
import { Guest } from '../entity/guest.entity';
import { Member } from '../../member/entity/member.entity';
import {
  CreateChurchClassDto,
  UpdateChurchClassDto,
} from '../dto/create-church-class.dto';
import { UpdateClassSessionDto } from '../dto/update-class-session.dto';
import { BulkEnrollDto, EnrollMemberDto } from '../dto/enroll-member.dto';
import { BulkEnrollGuestsDto, EnrollGuestDto } from '../dto/guest.dto';
import { PromoteEnrollmentDto } from '../dto/promote-enrollment.dto';
import { IssueCertificateDto } from '../dto/issue-certificate.dto';
import { EnrollmentStatusEnum } from '../enum/enrollment-status.enum';
import { ChurchClassStatusEnum } from '../enum/church-class-status.enum';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import { GuestService } from './guest.service';
import { ConfigService } from '@nestjs/config';

export interface ClassMaterialLibraryEntry {
  documentUrl: string;
  usedByClassNames: string[];
}

export interface ClassEnrollmentBreakdown {
  classId: string;
  className: string;
  inProgress: number;
  completed: number;
  cancelled: number;
  completionRate: number;
}

@Injectable()
export class ClassesService {
  private readonly logger = new Logger(ClassesService.name);
  private readonly productName: string;
  private readonly churchName: string;
  private readonly churchAddress: string;

  constructor(
    @InjectRepository(ChurchClass)
    private readonly classRepo: Repository<ChurchClass>,
    @InjectRepository(ClassEnrollment)
    private readonly enrollmentRepo: Repository<ClassEnrollment>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    private readonly auditLogService: AuditLogService,
    private readonly utilityService: UtilityService,
    private readonly configService: ConfigService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly guestService: GuestService,
  ) {
    this.productName = this.configService.get<string>('PRODUCT_NAME');
    this.churchName = this.configService.get<string>('CHURCH_NAME');
    this.churchAddress = this.configService.get<string>('CHURCH_ADDRESS');
  }

  async createClass(dto: CreateChurchClassDto): Promise<ChurchClass> {
    const churchClass = this.classRepo.create({
      name: dto.name,
      classType: { id: dto.classTypeId } as ClassType,
      description: dto.description ?? null,
      documentUrl: dto.documentUrl ?? null,
      startDate: dto.startDate ?? null,
      endDate: dto.endDate ?? null,
      facilitator: dto.facilitatorId ? { id: dto.facilitatorId } : null,
    });
    const saved = await this.classRepo.save(churchClass);
    this.logger.log(`Class "${saved.name}" created (id: ${saved.id})`);
    return saved;
  }

  async updateClass(
    id: string,
    dto: UpdateChurchClassDto,
  ): Promise<ChurchClass> {
    const churchClass = await this.getClassOrThrow(id);

    if (dto.name !== undefined) churchClass.name = dto.name;
    if (dto.classTypeId !== undefined)
      churchClass.classType = { id: dto.classTypeId } as ClassType;
    if (dto.description !== undefined)
      churchClass.description = dto.description;
    if (dto.documentUrl !== undefined)
      churchClass.documentUrl = dto.documentUrl;
    if (dto.startDate !== undefined) churchClass.startDate = dto.startDate;
    if (dto.endDate !== undefined) churchClass.endDate = dto.endDate;
    if (dto.facilitatorId !== undefined) {
      churchClass.facilitator = dto.facilitatorId
        ? ({ id: dto.facilitatorId } as Member)
        : null;
    }

    const saved = await this.classRepo.save(churchClass);
    this.logger.log(`Class "${saved.name}" updated (id: ${saved.id})`);
    return saved;
  }

  async updateClassSession(
    id: string,
    dto: UpdateClassSessionDto,
  ): Promise<ChurchClass> {
    const churchClass = await this.getClassOrThrow(id);

    if (dto.nextSessionAt !== undefined) {
      churchClass.nextSessionAt = dto.nextSessionAt
        ? new Date(dto.nextSessionAt)
        : null;
    }
    if (dto.meetingLink !== undefined) {
      churchClass.meetingLink = dto.meetingLink;
    }

    const saved = await this.classRepo.save(churchClass);
    this.logger.log(`Next session updated for class "${saved.name}"`);
    return saved;
  }

  async deleteClass(id: string): Promise<void> {
    const churchClass = await this.getClassOrThrow(id);

    const totalEnrollments = await this.enrollmentRepo.count({
      where: { churchClass: { id } },
    });
    if (totalEnrollments > 0) {
      this.logger.warn(
        `Delete of class "${churchClass.name}" blocked — ${totalEnrollments} enrollment record(s) exist`,
      );
      throw new BadRequestException(
        `Cannot delete this class — it has ${totalEnrollments} enrolment record(s). Classes with enrolment history cannot be deleted.`,
      );
    }

    const { name } = churchClass;
    await this.classRepo.remove(churchClass);
    this.logger.log(`Class "${name}" deleted (id: ${id})`);
  }

  async getClass(id: string): Promise<ChurchClass> {
    const churchClass = await this.classRepo.findOne({
      where: { id },
      relations: ['facilitator', 'classType', 'classType.nextClassType'],
    });
    if (!churchClass) throw new NotFoundException('Class not found');
    return churchClass;
  }

  async getAllClasses(
    classTypeId?: string,
    page = 1,
    limit = 10,
  ): Promise<PaginationResponseDto<ChurchClass>> {
    const query = this.classRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.facilitator', 'facilitator')
      .leftJoinAndSelect('c.classType', 'classType')
      .orderBy('c.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (classTypeId)
      query.where('classType.id = :classTypeId', { classTypeId });

    const [classes, total] = await query.getManyAndCount();
    return UtilityService.createPaginationResponse(classes, page, limit, total);
  }

  async closeClass(id: string): Promise<{ closedEnrollments: number }> {
    const churchClass = await this.getClassOrThrow(id);

    if (churchClass.status === ChurchClassStatusEnum.CLOSED) {
      throw new BadRequestException('Class is already closed');
    }

    const now = new Date();

    const result = await this.enrollmentRepo
      .createQueryBuilder()
      .update(ClassEnrollment)
      .set({ status: EnrollmentStatusEnum.COMPLETED, completedAt: now })
      .where('church_class_id = :id', { id })
      .andWhere('status = :status', {
        status: EnrollmentStatusEnum.IN_PROGRESS,
      })
      .execute();

    churchClass.status = ChurchClassStatusEnum.CLOSED;
    await this.classRepo.save(churchClass);

    const closedEnrollments = result.affected ?? 0;
    this.logger.log(
      `Class "${churchClass.name}" closed — ${closedEnrollments} in-progress enrollment(s) completed`,
    );
    return { closedEnrollments };
  }

  async enrollMember(dto: EnrollMemberDto): Promise<ClassEnrollment> {
    const churchClass = await this.getClassOrThrow(dto.classId);

    if (churchClass.status === ChurchClassStatusEnum.CLOSED) {
      throw new BadRequestException(
        'Cannot enrol a member into a closed class',
      );
    }

    const memberExists = await this.memberRepo.existsBy({ id: dto.memberId });
    if (!memberExists) throw new NotFoundException('Member not found');

    const existing = await this.enrollmentRepo.findOne({
      where: {
        member: { id: dto.memberId },
        churchClass: { id: dto.classId },
      },
    });

    if (existing) {
      if (existing.status === EnrollmentStatusEnum.COMPLETED) {
        throw new BadRequestException(
          'Member has already completed this class',
        );
      }
      if (existing.status === EnrollmentStatusEnum.IN_PROGRESS) {
        throw new BadRequestException(
          'Member is already enrolled in this class',
        );
      }
      // CANCELLED — reset the existing record rather than creating a duplicate
      // (the @Unique constraint on member+class prevents a second row)
      existing.status = EnrollmentStatusEnum.IN_PROGRESS;
      existing.cancelledAt = null;
      existing.completedAt = null;
      const re = await this.enrollmentRepo.save(existing);
      this.logger.log(
        `Member ${dto.memberId} re-enrolled in class "${churchClass.name}" (id: ${churchClass.id})`,
      );
      return re;
    }

    const enrollment = this.enrollmentRepo.create({
      member: { id: dto.memberId } as Member,
      churchClass,
      status: EnrollmentStatusEnum.IN_PROGRESS,
    });
    const saved = await this.enrollmentRepo.save(enrollment);
    this.logger.log(
      `Member ${dto.memberId} enrolled in class "${churchClass.name}" (id: ${churchClass.id})`,
    );
    return saved;
  }

  async bulkEnrollMembers(
    dto: BulkEnrollDto,
  ): Promise<{ enrolled: number; skipped: number }> {
    const churchClass = await this.getClassOrThrow(dto.classId);

    if (churchClass.status === ChurchClassStatusEnum.CLOSED) {
      throw new BadRequestException('Cannot enrol members into a closed class');
    }

    // Batched instead of looping enrollMember() per id (which re-fetched the
    // class and did its own existence/duplicate checks per member) — one
    // member-validity check, one existing-enrollment check, and one bulk
    // save regardless of batch size.
    const uniqueIds = Array.from(new Set(dto.memberIds));

    const validMembers = await this.memberRepo.find({
      where: { id: In(uniqueIds) },
      select: ['id'],
    });
    const validIds = new Set(validMembers.map((m) => m.id));

    const existingEnrollments = await this.enrollmentRepo.find({
      where: {
        churchClass: { id: dto.classId },
        member: { id: In(uniqueIds) },
      },
      relations: ['member'],
    });
    const existingByMemberId = new Map(
      existingEnrollments.map((e) => [e.member.id, e]),
    );

    const toSave: ClassEnrollment[] = [];
    let skipped = 0;

    for (const memberId of uniqueIds) {
      if (!validIds.has(memberId)) {
        skipped++;
        continue;
      }
      const existing = existingByMemberId.get(memberId);
      if (existing) {
        if (existing.status !== EnrollmentStatusEnum.CANCELLED) {
          skipped++;
          continue;
        }
        existing.status = EnrollmentStatusEnum.IN_PROGRESS;
        existing.cancelledAt = null;
        existing.completedAt = null;
        toSave.push(existing);
      } else {
        toSave.push(
          this.enrollmentRepo.create({
            member: { id: memberId } as Member,
            churchClass,
            status: EnrollmentStatusEnum.IN_PROGRESS,
          }),
        );
      }
    }

    if (toSave.length > 0) {
      await this.enrollmentRepo.save(toSave);
    }

    const enrolled = toSave.length;
    this.logger.log(
      `Bulk enrol in "${churchClass.name}": ${enrolled} enrolled, ${skipped} skipped`,
    );
    return { enrolled, skipped };
  }

  // Minimal shape for the Announcements "Class" audience picker — mirrors
  // GroupService's lookup method feeding GET /groups/lookup. Includes
  // startDate/endDate so the picker can show each class's dates, since a
  // ChurchClass row is already a specific dated cohort (the same class
  // "name" can recur as several rows over time).
  async getClassLookup(): Promise<
    Pick<ChurchClass, 'id' | 'name' | 'startDate' | 'endDate'>[]
  > {
    return this.classRepo.find({
      select: ['id', 'name', 'startDate', 'endDate'],
      order: { createdAt: 'DESC' },
    });
  }

  // Backs the Announcements module's CLASS audience (push/in-app) —
  // mirrors GroupService.getMemberIdsForGroup. In Progress + Completed
  // only (excludes Cancelled), same scope the audience picker uses.
  async getMemberIdsForClass(classId: string): Promise<string[]> {
    const rows = await this.enrollmentRepo
      .createQueryBuilder('e')
      .select('e.member_id', 'memberId')
      .where('e.church_class_id = :classId', { classId })
      .andWhere('e.status IN (:...statuses)', {
        statuses: [
          EnrollmentStatusEnum.IN_PROGRESS,
          EnrollmentStatusEnum.COMPLETED,
        ],
      })
      .andWhere('e.member_id IS NOT NULL')
      .getRawMany<{ memberId: string }>();
    return rows.map((r) => r.memberId);
  }

  // Backs the Announcements module's CLASS audience (SMS) — the guest side
  // of the same dual-source union GroupService uses for member vs.
  // phone-only entries. Guests have no Member account, so their phone
  // (when on file) is the only channel besides email.
  async getGuestPhonesForClass(classId: string): Promise<string[]> {
    const rows = await this.enrollmentRepo
      .createQueryBuilder('e')
      .innerJoin('e.guest', 'guest')
      .select('guest.phone', 'phone')
      .where('e.church_class_id = :classId', { classId })
      .andWhere('e.status IN (:...statuses)', {
        statuses: [
          EnrollmentStatusEnum.IN_PROGRESS,
          EnrollmentStatusEnum.COMPLETED,
        ],
      })
      .andWhere('guest.phone IS NOT NULL')
      .getRawMany<{ phone: string }>();
    return rows.map((r) => r.phone).filter((p): p is string => !!p);
  }

  async enrollGuest(dto: EnrollGuestDto): Promise<ClassEnrollment> {
    const churchClass = await this.getClassOrThrow(dto.classId);

    if (churchClass.status === ChurchClassStatusEnum.CLOSED) {
      throw new BadRequestException('Cannot enrol a guest into a closed class');
    }

    const guest = dto.guestId
      ? await this.guestService.getById(dto.guestId)
      : await this.guestService.findOrCreateByEmail({
          firstName: dto.firstName!,
          lastName: dto.lastName!,
          email: dto.email!,
          phone: dto.phone,
          churchName: dto.churchName,
          address: dto.address,
          notes: dto.notes,
        });

    const existing = await this.enrollmentRepo.findOne({
      where: { guest: { id: guest.id }, churchClass: { id: dto.classId } },
    });

    if (existing) {
      if (existing.status === EnrollmentStatusEnum.COMPLETED) {
        throw new BadRequestException(
          'This guest has already completed this class',
        );
      }
      if (existing.status === EnrollmentStatusEnum.IN_PROGRESS) {
        throw new BadRequestException(
          'This guest is already enrolled in this class',
        );
      }
      existing.status = EnrollmentStatusEnum.IN_PROGRESS;
      existing.cancelledAt = null;
      existing.completedAt = null;
      if (dto.purpose !== undefined) existing.purpose = dto.purpose;
      const re = await this.enrollmentRepo.save(existing);
      this.logger.log(
        `Guest ${guest.id} re-enrolled in class "${churchClass.name}" (id: ${churchClass.id})`,
      );
      return re;
    }

    const enrollment = this.enrollmentRepo.create({
      guest,
      churchClass,
      purpose: dto.purpose ?? null,
      status: EnrollmentStatusEnum.IN_PROGRESS,
    });
    const saved = await this.enrollmentRepo.save(enrollment);
    this.logger.log(
      `Guest ${guest.id} enrolled in class "${churchClass.name}" (id: ${churchClass.id})`,
    );

    await this.sendGuestPortalAccessEmail(guest, saved, churchClass);

    return saved;
  }

  async bulkEnrollGuests(
    dto: BulkEnrollGuestsDto,
  ): Promise<{ enrolled: number; skipped: number }> {
    const churchClass = await this.getClassOrThrow(dto.classId);

    if (churchClass.status === ChurchClassStatusEnum.CLOSED) {
      throw new BadRequestException('Cannot enrol guests into a closed class');
    }

    let enrolled = 0;
    let skipped = 0;

    for (const entry of dto.guests) {
      try {
        await this.enrollGuest({
          classId: dto.classId,
          firstName: entry.firstName,
          lastName: entry.lastName,
          email: entry.email,
          phone: entry.phone,
        });
        enrolled++;
      } catch (err) {
        this.logger.warn(
          `Skipped bulk guest enrol for ${entry.email}: ${err instanceof Error ? err.message : err}`,
        );
        skipped++;
      }
    }

    this.logger.log(
      `Bulk guest enrol in "${churchClass.name}": ${enrolled} enrolled, ${skipped} skipped`,
    );
    return { enrolled, skipped };
  }

  // Resolves the tenant-subdomain portal URL (a cheap cached lookup, so
  // worth awaiting) then fires the email without waiting on the send
  // itself, matching this codebase's email convention. Portal access is
  // the enrollment's own id (see ClassPublicController) — no separate
  // token to generate.
  private async sendGuestPortalAccessEmail(
    guest: Guest,
    enrollment: ClassEnrollment,
    churchClass: ChurchClass,
  ): Promise<void> {
    const firstName = UtilityService.capitalizeFirstLetter(guest.firstName);
    const portalUrl = await this.utilityService.resolveMemberUrl(
      `/classes/guest/${enrollment.id}`,
    );
    this.utilityService.sendEmailWithTemplate(
      guest.email,
      `${firstName}, You're Enrolled in ${churchClass.name}`,
      'class-guest-access',
      {
        name: firstName,
        className: churchClass.name,
        portalUrl,
        churchName: this.churchName,
        churchAddress: this.churchAddress,
      },
    );
  }

  async countActiveEnrollments(): Promise<number> {
    return this.enrollmentRepo.count({
      where: { status: EnrollmentStatusEnum.IN_PROGRESS },
    });
  }

  async getClassEnrollmentBreakdown(): Promise<ClassEnrollmentBreakdown[]> {
    const rows = await this.classRepo
      .createQueryBuilder('c')
      .leftJoin('c.enrollments', 'e')
      .select('c.id', 'classId')
      .addSelect('c.name', 'className')
      .addSelect(
        `SUM(CASE WHEN e.status = 'IN_PROGRESS' THEN 1 ELSE 0 END)`,
        'inProgress',
      )
      .addSelect(
        `SUM(CASE WHEN e.status = 'COMPLETED' THEN 1 ELSE 0 END)`,
        'completed',
      )
      .addSelect(
        `SUM(CASE WHEN e.status = 'CANCELLED' THEN 1 ELSE 0 END)`,
        'cancelled',
      )
      .groupBy('c.id, c.name')
      .orderBy('c.name', 'ASC')
      .getRawMany<{
        classId: string;
        className: string;
        inProgress: string;
        completed: string;
        cancelled: string;
      }>();

    return rows.map((r) => {
      const completed = Number.parseInt(r.completed, 10);
      const cancelled = Number.parseInt(r.cancelled, 10);
      const denominator = completed + cancelled;
      return {
        classId: r.classId,
        className: r.className,
        inProgress: Number.parseInt(r.inProgress, 10),
        completed,
        cancelled,
        completionRate:
          denominator === 0
            ? 0
            : Math.min(
                Number(((completed / denominator) * 100).toFixed(2)),
                100,
              ),
      };
    });
  }

  async getClassCompletionsTrend(
    daysAgo = 90,
  ): Promise<{ week: string; completions: number }[]> {
    const since = new Date();
    since.setDate(since.getDate() - daysAgo);

    const rows = await this.enrollmentRepo
      .createQueryBuilder('e')
      .select(
        "TO_CHAR(DATE_TRUNC('week', e.completedAt), 'YYYY-MM-DD')",
        'week',
      )
      .addSelect('COUNT(*)', 'completions')
      .where(`e.status = 'COMPLETED'`)
      .andWhere('e.completedAt >= :since', { since })
      .groupBy("DATE_TRUNC('week', e.completedAt)")
      .orderBy("DATE_TRUNC('week', e.completedAt)", 'ASC')
      .getRawMany<{ week: string; completions: string }>();

    return rows.map((r) => ({
      week: r.week,
      completions: Number.parseInt(r.completions, 10),
    }));
  }

  async updateEnrollmentStatus(
    enrollmentId: string,
    status: EnrollmentStatusEnum,
  ): Promise<ClassEnrollment> {
    const enrollment = await this.getEnrollmentOrThrow(enrollmentId);

    enrollment.status = status;
    if (status === EnrollmentStatusEnum.COMPLETED) {
      enrollment.completedAt = new Date();
      enrollment.cancelledAt = null;
    } else if (status === EnrollmentStatusEnum.CANCELLED) {
      enrollment.cancelledAt = new Date();
      enrollment.completedAt = null;
    }

    const saved = await this.enrollmentRepo.save(enrollment);
    this.logger.log(`Enrollment ${enrollmentId} status updated to ${status}`);
    return saved;
  }

  async getMyEnrollments(memberId: string): Promise<ClassEnrollment[]> {
    return this.enrollmentRepo.find({
      where: { member: { id: memberId } },
      relations: ['churchClass', 'churchClass.classType'],
      order: { enrolledAt: 'DESC' },
    });
  }

  async getClassEnrollments(
    classId: string,
    page = 1,
    limit = 10,
  ): Promise<PaginationResponseDto<ClassEnrollment>> {
    await this.getClassOrThrow(classId);

    const [enrollments, total] = await this.enrollmentRepo.findAndCount({
      where: { churchClass: { id: classId } },
      relations: ['member', 'guest'],
      skip: (page - 1) * limit,
      take: limit,
      order: { enrolledAt: 'DESC' },
    });

    return UtilityService.createPaginationResponse(
      enrollments,
      page,
      limit,
      total,
    );
  }

  async getPromotionCandidate(enrollmentId: string): Promise<{
    eligible: boolean;
    nextClassType: ClassType | null;
    openClasses: ChurchClass[];
  }> {
    const enrollment = await this.enrollmentRepo.findOne({
      where: { id: enrollmentId },
      relations: [
        'churchClass',
        'churchClass.classType',
        'churchClass.classType.nextClassType',
      ],
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');

    const nextClassType = enrollment.churchClass.classType.nextClassType;
    if (
      enrollment.status !== EnrollmentStatusEnum.COMPLETED ||
      !nextClassType
    ) {
      return { eligible: false, nextClassType: null, openClasses: [] };
    }

    const openClasses = await this.classRepo.find({
      where: {
        classType: { id: nextClassType.id },
        status: ChurchClassStatusEnum.ACTIVE,
      },
      order: { createdAt: 'DESC' },
    });

    return { eligible: true, nextClassType, openClasses };
  }

  async promoteEnrollment(
    enrollmentId: string,
    dto: PromoteEnrollmentDto,
    actorId: string,
  ): Promise<ClassEnrollment> {
    const enrollment = await this.enrollmentRepo.findOne({
      where: { id: enrollmentId },
      relations: [
        'member',
        'guest',
        'churchClass',
        'churchClass.classType',
        'churchClass.classType.nextClassType',
      ],
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');

    if (enrollment.status !== EnrollmentStatusEnum.COMPLETED) {
      throw new BadRequestException(
        'Only completed enrollments can be promoted',
      );
    }

    const nextClassType = enrollment.churchClass.classType.nextClassType;
    if (!nextClassType) {
      throw new BadRequestException(
        'This class type has no next level to promote into',
      );
    }

    const targetClass = await this.classRepo.findOne({
      where: { id: dto.targetClassId },
      relations: ['classType'],
    });
    if (!targetClass) throw new NotFoundException('Target class not found');
    if (targetClass.classType.id !== nextClassType.id) {
      throw new BadRequestException(
        'Target class is not of the expected next class type',
      );
    }

    const newEnrollment = enrollment.member
      ? await this.enrollMember({
          memberId: enrollment.member.id,
          classId: targetClass.id,
        })
      : await this.enrollGuest({
          classId: targetClass.id,
          guestId: enrollment.guest!.id,
        });

    const email = enrollment.member?.email ?? enrollment.guest!.email;
    const firstName = UtilityService.capitalizeFirstLetter(
      enrollment.member?.firstname ?? enrollment.guest!.firstName,
    );
    const lastName = enrollment.member?.lastname ?? enrollment.guest!.lastName;
    const targetId = enrollment.member?.id ?? enrollment.guest!.id;

    this.auditLogService.log('CLASS_LEVEL_PROMOTED', {
      actorId,
      targetId,
      targetEmail: email,
      targetName: `${firstName} ${lastName}`,
      metadata: {
        fromClassId: enrollment.churchClass.id,
        fromClassTypeId: enrollment.churchClass.classType.id,
        toClassId: targetClass.id,
        toClassTypeId: nextClassType.id,
      },
    });

    this.utilityService.sendEmailWithTemplate(
      email,
      `${firstName}, You've Been Promoted to ${targetClass.name}`,
      'class-level-promotion',
      {
        name: firstName,
        fromClassName: enrollment.churchClass.name,
        toClassName: targetClass.name,
        churchName: this.churchName,
        churchAddress: this.churchAddress,
      },
    );

    this.logger.log(
      `${targetId} promoted from class "${enrollment.churchClass.name}" to "${targetClass.name}"`,
    );

    return newEnrollment;
  }

  async issueCertificate(
    enrollmentId: string,
    dto: IssueCertificateDto,
    actorId: string,
  ): Promise<ClassEnrollment> {
    const enrollment = await this.enrollmentRepo.findOne({
      where: { id: enrollmentId },
      relations: ['member', 'guest', 'churchClass'],
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');

    if (enrollment.status !== EnrollmentStatusEnum.COMPLETED) {
      throw new BadRequestException(
        'Only completed enrollments can have a certificate issued',
      );
    }

    enrollment.certificateIssued = true;
    enrollment.certificateIssuedAt = new Date();
    enrollment.certificateNumber = dto.certificateNumber ?? null;

    const saved = await this.enrollmentRepo.save(enrollment);

    const targetId = enrollment.member?.id ?? enrollment.guest!.id;
    const targetEmail = enrollment.member?.email ?? enrollment.guest!.email;
    const targetName = enrollment.member
      ? `${enrollment.member.firstname} ${enrollment.member.lastname}`
      : `${enrollment.guest!.firstName} ${enrollment.guest!.lastName}`;

    this.auditLogService.log('CLASS_CERTIFICATE_ISSUED', {
      actorId,
      targetId,
      targetEmail,
      targetName,
      metadata: {
        enrollmentId,
        classId: enrollment.churchClass.id,
        certificateNumber: enrollment.certificateNumber,
      },
    });

    this.logger.log(
      `Certificate issued for enrollment ${enrollmentId} (class "${enrollment.churchClass.name}")`,
    );
    return saved;
  }

  async uploadMaterial(file: Express.Multer.File): Promise<{ url: string }> {
    const uploaded = await this.cloudinaryService.uploadBuffer(
      file.buffer,
      'class-materials',
      undefined,
      file.mimetype,
    );
    return { url: uploaded.secureUrl };
  }

  // Lets the admin UI offer "reuse a previous upload" instead of
  // re-uploading the same syllabus/manual for every class it applies to —
  // just the distinct documentUrls already in use, grouped by which
  // classes reference each one, since ChurchClass.documentUrl has no
  // separate library table backing it.
  async getMaterialLibrary(): Promise<ClassMaterialLibraryEntry[]> {
    const classes = await this.classRepo.find({
      select: ['name', 'documentUrl'],
    });
    const withMaterial = classes.filter((c) => !!c.documentUrl);

    const byUrl = new Map<string, string[]>();
    for (const c of withMaterial) {
      const names = byUrl.get(c.documentUrl!) ?? [];
      names.push(c.name);
      byUrl.set(c.documentUrl!, names);
    }

    return [...byUrl.entries()].map(([documentUrl, usedByClassNames]) => ({
      documentUrl,
      usedByClassNames,
    }));
  }

  private async getClassOrThrow(id: string): Promise<ChurchClass> {
    const churchClass = await this.classRepo.findOne({ where: { id } });
    if (!churchClass) throw new NotFoundException('Class not found');
    return churchClass;
  }

  private async getEnrollmentOrThrow(id: string): Promise<ClassEnrollment> {
    const enrollment = await this.enrollmentRepo.findOne({ where: { id } });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    return enrollment;
  }

  // Used by ClassPublicController's @Public() guest-portal routes — the
  // enrollment id itself is the access key (no separate token, mirroring
  // how the public Forms feature uses a form's own id), so this only ever
  // resolves rows that actually have a guest attached; a member's
  // enrollment id returns the same 404 a nonexistent one would.
  async getGuestEnrollmentOrThrow(id: string): Promise<ClassEnrollment> {
    const enrollment = await this.enrollmentRepo.findOne({
      where: { id },
      relations: ['guest', 'churchClass'],
    });
    if (!enrollment?.guest) {
      throw new NotFoundException('Enrollment not found');
    }
    return enrollment;
  }
}
