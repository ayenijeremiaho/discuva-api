import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { VolunteerOpportunity } from '../entity/volunteer-opportunity.entity';
import { VolunteerSignup } from '../entity/volunteer-signup.entity';
import { VolunteerOpportunityStatusEnum } from '../enum/volunteer-opportunity-status.enum';
import { VolunteerSignupStatusEnum } from '../enum/volunteer-signup-status.enum';
import {
  CreateVolunteerOpportunityDto,
  UpdateVolunteerOpportunityDto,
} from '../dto/volunteer-opportunity.dto';
import { Department } from '../../department/entity/department.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { Member } from '../../member/entity/member.entity';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

export interface VolunteerOpportunityWithMyStatus extends VolunteerOpportunity {
  mySignupStatus: VolunteerSignupStatusEnum | null;
}

@Injectable()
export class VolunteerService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(VolunteerOpportunity)
    private readonly opportunityRepo: Repository<VolunteerOpportunity>,
    @InjectRepository(VolunteerSignup)
    private readonly signupRepo: Repository<VolunteerSignup>,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(
    dto: CreateVolunteerOpportunityDto,
    admin: Admin,
  ): Promise<VolunteerOpportunity> {
    const opportunity = this.opportunityRepo.create({
      title: dto.title,
      description: dto.description ?? null,
      department: dto.departmentId
        ? ({ id: dto.departmentId } as Department)
        : null,
      date: new Date(dto.date),
      capacity: dto.capacity ?? null,
      createdBy: { id: admin.id } as Admin,
    });

    const saved = await this.opportunityRepo.save(opportunity);
    this.auditLogService.log('VOLUNTEER_OPPORTUNITY_CREATED', {
      actorId: admin.id,
      targetId: saved.id,
      metadata: { title: saved.title },
    });
    return saved;
  }

  async update(
    id: string,
    dto: UpdateVolunteerOpportunityDto,
    admin: Admin,
  ): Promise<VolunteerOpportunity> {
    const opportunity = await this.getOrThrow(id);

    if (dto.title !== undefined) opportunity.title = dto.title;
    if (dto.description !== undefined)
      opportunity.description = dto.description;
    if (dto.departmentId !== undefined) {
      opportunity.department = dto.departmentId
        ? ({ id: dto.departmentId } as Department)
        : null;
    }
    if (dto.date !== undefined) opportunity.date = new Date(dto.date);
    if (dto.capacity !== undefined) opportunity.capacity = dto.capacity;

    const saved = await this.opportunityRepo.save(opportunity);
    this.auditLogService.log('VOLUNTEER_OPPORTUNITY_UPDATED', {
      actorId: admin.id,
      targetId: id,
      metadata: { changes: Object.keys(dto) },
    });
    return saved;
  }

  async cancelOpportunity(
    id: string,
    admin: Admin,
  ): Promise<VolunteerOpportunity> {
    const opportunity = await this.getOrThrow(id);
    opportunity.status = VolunteerOpportunityStatusEnum.CANCELLED;
    const saved = await this.opportunityRepo.save(opportunity);
    this.auditLogService.log('VOLUNTEER_OPPORTUNITY_CANCELLED', {
      actorId: admin.id,
      targetId: id,
    });
    return saved;
  }

  async listOpportunities(
    page = 1,
    limit = 20,
  ): Promise<PaginationResponseDto<VolunteerOpportunity>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');

    const [data, total] = await this.opportunityRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.department', 'department')
      .leftJoinAndSelect('o.createdBy', 'createdBy')
      .orderBy('o.date', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async getRoster(opportunityId: string): Promise<VolunteerSignup[]> {
    await this.getOrThrow(opportunityId);
    return this.signupRepo.find({
      where: {
        opportunity: { id: opportunityId },
        status: VolunteerSignupStatusEnum.CONFIRMED,
      },
      relations: ['member'],
      order: { createdAt: 'ASC' },
    });
  }

  async listOpen(
    page = 1,
    limit = 20,
    memberId: string,
  ): Promise<PaginationResponseDto<VolunteerOpportunityWithMyStatus>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');

    const [rows, total] = await this.opportunityRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.department', 'department')
      .where('o.status = :status', {
        status: VolunteerOpportunityStatusEnum.OPEN,
      })
      .andWhere('o.date >= :now', { now: new Date() })
      .orderBy('o.date', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const mySignups = rows.length
      ? await this.signupRepo.find({
          where: rows.map((o) => ({
            opportunity: { id: o.id },
            member: { id: memberId },
          })),
        })
      : [];
    const statusByOpportunity = new Map(
      mySignups.map((s) => [s.opportunity.id, s.status]),
    );

    const data: VolunteerOpportunityWithMyStatus[] = rows.map((o) =>
      Object.assign(o, {
        mySignupStatus: statusByOpportunity.get(o.id) ?? null,
      }),
    );

    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async signUp(
    opportunityId: string,
    memberId: string,
  ): Promise<VolunteerSignup> {
    return this.dataSource.transaction(async (manager) => {
      const opportunity = await manager
        .getRepository(VolunteerOpportunity)
        .createQueryBuilder('o')
        .where('o.id = :id', { id: opportunityId })
        .setLock('pessimistic_write')
        .getOne();
      if (!opportunity) throw new NotFoundException('Opportunity not found');

      // Check for an already-CONFIRMED signup before the status/capacity
      // gates below — a member re-confirming their own existing spot is
      // idempotent and shouldn't be rejected just because the opportunity
      // has since closed or filled up around them.
      const signupRepo = manager.getRepository(VolunteerSignup);
      const existing = await signupRepo.findOne({
        where: { opportunity: { id: opportunityId }, member: { id: memberId } },
      });
      if (existing?.status === VolunteerSignupStatusEnum.CONFIRMED) {
        return existing;
      }

      if (opportunity.status !== VolunteerOpportunityStatusEnum.OPEN) {
        throw new BadRequestException(
          'This opportunity is not open for sign-up.',
        );
      }
      if (
        opportunity.capacity !== null &&
        opportunity.confirmedCount >= opportunity.capacity
      ) {
        throw new BadRequestException('This opportunity is full.');
      }

      let signup: VolunteerSignup;
      if (existing) {
        existing.status = VolunteerSignupStatusEnum.CONFIRMED;
        signup = await signupRepo.save(existing);
      } else {
        signup = await signupRepo.save(
          signupRepo.create({
            opportunity: { id: opportunityId } as VolunteerOpportunity,
            member: { id: memberId } as Member,
            status: VolunteerSignupStatusEnum.CONFIRMED,
          }),
        );
      }

      opportunity.confirmedCount += 1;
      await manager.getRepository(VolunteerOpportunity).save(opportunity);

      this.auditLogService.log('VOLUNTEER_SIGNUP_CREATED', {
        actorId: memberId,
        targetId: opportunityId,
      });

      return signup;
    });
  }

  async cancelMySignUp(opportunityId: string, memberId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const opportunity = await manager
        .getRepository(VolunteerOpportunity)
        .createQueryBuilder('o')
        .where('o.id = :id', { id: opportunityId })
        .setLock('pessimistic_write')
        .getOne();
      if (!opportunity) throw new NotFoundException('Opportunity not found');

      const signupRepo = manager.getRepository(VolunteerSignup);
      const signup = await signupRepo.findOne({
        where: {
          opportunity: { id: opportunityId },
          member: { id: memberId },
          status: VolunteerSignupStatusEnum.CONFIRMED,
        },
      });
      if (!signup)
        throw new NotFoundException(
          'You are not signed up for this opportunity',
        );

      signup.status = VolunteerSignupStatusEnum.CANCELLED;
      await signupRepo.save(signup);

      opportunity.confirmedCount = Math.max(0, opportunity.confirmedCount - 1);
      await manager.getRepository(VolunteerOpportunity).save(opportunity);
    });
  }

  private async getOrThrow(id: string): Promise<VolunteerOpportunity> {
    const opportunity = await this.opportunityRepo.findOne({ where: { id } });
    if (!opportunity) throw new NotFoundException('Opportunity not found');
    return opportunity;
  }
}
