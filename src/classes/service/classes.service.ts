import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChurchClass } from '../entity/church-class.entity';
import { ClassEnrollment } from '../entity/class-enrollment.entity';
import { Member } from '../../member/entity/member.entity';
import {
  CreateChurchClassDto,
  UpdateChurchClassDto,
} from '../dto/create-church-class.dto';
import { BulkEnrollDto, EnrollMemberDto } from '../dto/enroll-member.dto';
import { EnrollmentStatusEnum } from '../enum/enrollment-status.enum';
import { ChurchClassTypeEnum } from '../enum/church-class-type.enum';
import { ChurchClassStatusEnum } from '../enum/church-class-status.enum';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';

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

  constructor(
    @InjectRepository(ChurchClass)
    private readonly classRepo: Repository<ChurchClass>,
    @InjectRepository(ClassEnrollment)
    private readonly enrollmentRepo: Repository<ClassEnrollment>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
  ) {}

  async createClass(dto: CreateChurchClassDto): Promise<ChurchClass> {
    const churchClass = this.classRepo.create({
      name: dto.name,
      type: dto.type,
      description: dto.description ?? null,
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
    if (dto.description !== undefined)
      churchClass.description = dto.description;
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
      relations: ['facilitator'],
    });
    if (!churchClass) throw new NotFoundException('Class not found');
    return churchClass;
  }

  async getAllClasses(
    type?: ChurchClassTypeEnum,
    page = 1,
    limit = 10,
  ): Promise<PaginationResponseDto<ChurchClass>> {
    const query = this.classRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.facilitator', 'facilitator')
      .orderBy('c.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (type) query.where('c.type = :type', { type });

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

    let enrolled = 0;
    let skipped = 0;

    for (const memberId of dto.memberIds) {
      try {
        await this.enrollMember({ memberId, classId: dto.classId });
        enrolled++;
      } catch {
        skipped++;
      }
    }

    this.logger.log(
      `Bulk enrol in "${churchClass.name}": ${enrolled} enrolled, ${skipped} skipped`,
    );
    return { enrolled, skipped };
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
      relations: ['churchClass'],
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
      relations: ['member'],
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
}
