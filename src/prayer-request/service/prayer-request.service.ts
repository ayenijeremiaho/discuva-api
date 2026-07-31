import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { PrayerRequest } from '../entity/prayer-request.entity';
import { Testimony } from '../entity/testimony.entity';
import { PregnancyPrayerCase } from '../entity/pregnancy-prayer-case.entity';
import { PregnancyPrayerVisit } from '../entity/pregnancy-prayer-visit.entity';
import { Pastor } from '../../member/entity/pastor.entity';
import { Member } from '../../member/entity/member.entity';
import {
  SubmitPrayerRequestDto,
  SubmitTestimonyDto,
  UpdatePrayerRequestStatusDto,
  CreatePregnancyCaseDto,
  LogPregnancyVisitDto,
  UpdatePregnancyCaseStatusDto,
} from '../dto/prayer-request.dto';
import { PrayerRequestStatusEnum } from '../enum/prayer-request-status.enum';
import { PregnancyCaseStatusEnum } from '../enum/pregnancy-case-status.enum';
import { DepartmentCapability } from '../../department/enums/department-capability.enum';
import { DepartmentAccessService } from '../../department/service/department-access.service';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { MemberService } from '../../member/service/member.service';
import { MemberAuth } from '../../auth/interface/auth.interface';

@Injectable()
export class PrayerRequestService {
  constructor(
    @InjectRepository(PrayerRequest)
    private readonly prayerRequestRepo: Repository<PrayerRequest>,
    @InjectRepository(Testimony)
    private readonly testimonyRepo: Repository<Testimony>,
    @InjectRepository(PregnancyPrayerCase)
    private readonly pregnancyCaseRepo: Repository<PregnancyPrayerCase>,
    @InjectRepository(PregnancyPrayerVisit)
    private readonly pregnancyVisitRepo: Repository<PregnancyPrayerVisit>,
    @InjectRepository(Pastor)
    private readonly pastorRepo: Repository<Pastor>,
    private readonly memberService: MemberService,
    private readonly auditLogService: AuditLogService,
    private readonly departmentAccessService: DepartmentAccessService,
  ) {}

  async submitRequest(
    dto: SubmitPrayerRequestDto,
    currentUser: MemberAuth,
  ): Promise<PrayerRequest> {
    const member = await this.memberService.getById(currentUser.id);
    const request = this.prayerRequestRepo.create({
      member: { id: member.id } as Member,
      submittedByName: `${member.firstname} ${member.lastname}`,
      content: dto.content,
      status: PrayerRequestStatusEnum.OPEN,
    });
    const saved = await this.prayerRequestRepo.save(request);

    this.auditLogService.log('PRAYER_REQUEST_SUBMITTED', {
      actorId: currentUser.id,
      targetId: saved.id,
    });

    return saved;
  }

  async submitTestimony(
    dto: SubmitTestimonyDto,
    currentUser: MemberAuth,
  ): Promise<Testimony> {
    const member = await this.memberService.getById(currentUser.id);

    let prayerRequest: PrayerRequest | null = null;
    if (dto.prayerRequestId) {
      prayerRequest = await this.prayerRequestRepo.findOne({
        where: { id: dto.prayerRequestId },
        relations: ['member'],
      });
      if (!prayerRequest) {
        throw new NotFoundException('Prayer request not found');
      }
      if (prayerRequest.member?.id !== member.id) {
        throw new ForbiddenException(
          'You can only attach a testimony to your own prayer request',
        );
      }
    }

    const testimony = this.testimonyRepo.create({
      member: { id: member.id } as Member,
      submittedByName: `${member.firstname} ${member.lastname}`,
      prayerRequest: prayerRequest
        ? ({ id: prayerRequest.id } as PrayerRequest)
        : null,
      content: dto.content,
      isPublic: dto.isPublic ?? false,
    });
    const saved = await this.testimonyRepo.save(testimony);

    this.auditLogService.log('TESTIMONY_SUBMITTED', {
      actorId: currentUser.id,
      targetId: saved.id,
      metadata: {
        isPublic: saved.isPublic,
        prayerRequestId: dto.prayerRequestId ?? null,
      },
    });

    return saved;
  }

  async getMyRequests(
    memberId: string,
    page = 1,
    limit = 10,
  ): Promise<PaginationResponseDto<PrayerRequest>> {
    const [data, total] = await this.prayerRequestRepo.findAndCount({
      where: { member: { id: memberId } },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async getMyTestimonies(
    memberId: string,
    page = 1,
    limit = 10,
  ): Promise<PaginationResponseDto<Testimony>> {
    const [data, total] = await this.testimonyRepo.findAndCount({
      where: { member: { id: memberId } },
      relations: ['prayerRequest'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async getPublicTestimonies(
    page = 1,
    limit = 10,
  ): Promise<PaginationResponseDto<Testimony>> {
    const [data, total] = await this.testimonyRepo.findAndCount({
      where: { isPublic: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async getAllRequestsForTeam(
    page = 1,
    limit = 10,
    status?: PrayerRequestStatusEnum,
  ): Promise<PaginationResponseDto<PrayerRequest>> {
    const where: FindOptionsWhere<PrayerRequest> = {};
    if (status) where.status = status;

    const [data, total] = await this.prayerRequestRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async getAllTestimoniesForAdmin(
    page = 1,
    limit = 10,
  ): Promise<PaginationResponseDto<Testimony>> {
    const [data, total] = await this.testimonyRepo.findAndCount({
      relations: ['prayerRequest'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async updateStatus(
    id: string,
    dto: UpdatePrayerRequestStatusDto,
    actorId: string,
  ): Promise<PrayerRequest> {
    const request = await this.prayerRequestRepo.findOne({ where: { id } });
    if (!request) throw new NotFoundException('Prayer request not found');

    request.status = dto.status;
    const saved = await this.prayerRequestRepo.save(request);

    this.auditLogService.log('PRAYER_REQUEST_STATUS_UPDATED', {
      actorId,
      targetId: saved.id,
      metadata: { status: dto.status },
    });

    return saved;
  }

  async createPregnancyCase(
    dto: CreatePregnancyCaseDto,
    currentUser: MemberAuth,
  ): Promise<PregnancyPrayerCase> {
    const creator = await this.memberService.getById(currentUser.id);

    const pregnancyCase = this.pregnancyCaseRepo.create({
      member: dto.memberId ? ({ id: dto.memberId } as Member) : null,
      name: dto.name,
      edd: dto.edd,
      details: dto.details ?? null,
      status: PregnancyCaseStatusEnum.ACTIVE,
      createdBy: { id: creator.id } as Member,
      createdByName: `${creator.firstname} ${creator.lastname}`,
    });
    const saved = await this.pregnancyCaseRepo.save(pregnancyCase);

    this.auditLogService.log('PREGNANCY_CASE_CREATED', {
      actorId: currentUser.id,
      targetId: saved.id,
    });

    return saved;
  }

  async logPregnancyVisit(
    caseId: string,
    dto: LogPregnancyVisitDto,
    currentUser: MemberAuth,
  ): Promise<PregnancyPrayerVisit> {
    const pregnancyCase = await this.pregnancyCaseRepo.findOne({
      where: { id: caseId },
    });
    if (!pregnancyCase) throw new NotFoundException('Pregnancy case not found');

    const logger = await this.memberService.getById(currentUser.id);

    const visit = this.pregnancyVisitRepo.create({
      case: pregnancyCase,
      loggedBy: { id: logger.id } as Member,
      loggedByName: `${logger.firstname} ${logger.lastname}`,
      note: dto.note ?? null,
    });
    const saved = await this.pregnancyVisitRepo.save(visit);

    pregnancyCase.lastPrayedAt = saved.visitedAt;
    await this.pregnancyCaseRepo.save(pregnancyCase);

    this.auditLogService.log('PREGNANCY_VISIT_LOGGED', {
      actorId: currentUser.id,
      targetId: saved.id,
      metadata: { caseId },
    });

    return saved;
  }

  async getPregnancyVisitHistory(
    caseId: string,
    page = 1,
    limit = 10,
  ): Promise<PaginationResponseDto<PregnancyPrayerVisit>> {
    const caseExists = await this.pregnancyCaseRepo.existsBy({ id: caseId });
    if (!caseExists) throw new NotFoundException('Pregnancy case not found');

    const [data, total] = await this.pregnancyVisitRepo.findAndCount({
      where: { case: { id: caseId } },
      order: { visitedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async getPregnancyCases(
    page = 1,
    limit = 10,
    status?: PregnancyCaseStatusEnum,
  ): Promise<PaginationResponseDto<PregnancyPrayerCase>> {
    const where: FindOptionsWhere<PregnancyPrayerCase> = {};
    if (status) where.status = status;

    const [data, total] = await this.pregnancyCaseRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async updatePregnancyCaseStatus(
    caseId: string,
    dto: UpdatePregnancyCaseStatusDto,
    actorId: string,
  ): Promise<PregnancyPrayerCase> {
    const pregnancyCase = await this.pregnancyCaseRepo.findOne({
      where: { id: caseId },
    });
    if (!pregnancyCase) throw new NotFoundException('Pregnancy case not found');

    pregnancyCase.status = dto.status;
    const saved = await this.pregnancyCaseRepo.save(pregnancyCase);

    this.auditLogService.log('PREGNANCY_CASE_STATUS_UPDATED', {
      actorId,
      targetId: saved.id,
      metadata: { status: dto.status },
    });

    return saved;
  }

  async assertIsPrayerTeamOrPastor(memberId: string): Promise<void> {
    const isPastor = await this.pastorRepo.exists({
      where: { member: { id: memberId } },
    });
    if (isPastor) return;

    if (
      await this.departmentAccessService.hasCapability(
        memberId,
        DepartmentCapability.MANAGE_PRAYER_REQUESTS,
      )
    ) {
      return;
    }

    throw new ForbiddenException(
      'Only Prayer department workers or pastors can perform this action',
    );
  }
}
