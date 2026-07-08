import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FinanceCategory } from '../entity/finance-category.entity';
import { FinanceRequest } from '../entity/finance-request.entity';
import { FinanceRequestStatus } from '../enum/finance-request.enum';
import {
  CreateFinanceCategoryDto,
  CreateFinanceRequestDto,
  RejectFinanceRequestDto,
  UpdateFinanceCategoryDto,
} from '../dto/finance-request.dto';
import { Admin } from '../../admin/entity/admin.entity';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import { ExcelService } from '../../utility/service/excel.service';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';

@Injectable()
export class FinanceRequestService {
  private readonly logger = new Logger(FinanceRequestService.name);
  private readonly currencyCode: string;
  private readonly currencyLocale: string;

  constructor(
    @InjectRepository(FinanceCategory)
    private readonly categoryRepo: Repository<FinanceCategory>,
    @InjectRepository(FinanceRequest)
    private readonly requestRepo: Repository<FinanceRequest>,
    @InjectRepository(Admin)
    private readonly adminRepo: Repository<Admin>,
    private readonly utilityService: UtilityService,
    private readonly auditLogService: AuditLogService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly excelService: ExcelService,
    private readonly config: ConfigService,
  ) {
    this.currencyCode = this.config.get<string>('CURRENCY_CODE');
    this.currencyLocale = this.config.get<string>('CURRENCY_LOCALE');
  }

  // ── Categories ────────────────────────────────────────────────────────────

  async getCategories(): Promise<FinanceCategory[]> {
    return this.categoryRepo.find({ order: { name: 'ASC' } });
  }

  async createCategory(
    dto: CreateFinanceCategoryDto,
    actorAdmin: Admin,
  ): Promise<FinanceCategory> {
    const exists = await this.categoryRepo.findOne({
      where: { name: dto.name },
    });
    if (exists)
      throw new ConflictException(`Category "${dto.name}" already exists`);

    const category = await this.categoryRepo.save(
      this.categoryRepo.create(dto),
    );
    this.auditLogService.log('FINANCE_CATEGORY_CREATED', {
      actorId: actorAdmin.member?.id,
      metadata: { name: dto.name },
    });
    return category;
  }

  async updateCategory(
    id: string,
    dto: UpdateFinanceCategoryDto,
    actorAdmin: Admin,
  ): Promise<FinanceCategory> {
    const category = await this.categoryRepo.findOne({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');

    if (dto.name && dto.name !== category.name) {
      const exists = await this.categoryRepo.findOne({
        where: { name: dto.name },
      });
      if (exists)
        throw new ConflictException(`Category "${dto.name}" already exists`);
    }

    Object.assign(category, dto);
    const updated = await this.categoryRepo.save(category);
    this.auditLogService.log('FINANCE_CATEGORY_UPDATED', {
      actorId: actorAdmin.member?.id,
      metadata: { id },
    });
    return updated;
  }

  // ── Requests (HOD) ────────────────────────────────────────────────────────

  async createRequest(
    dto: CreateFinanceRequestDto,
    user: MemberAuth,
    attachment?: Express.Multer.File,
  ): Promise<FinanceRequest> {
    const category = await this.categoryRepo.findOne({
      where: { id: dto.categoryId },
    });
    if (!category) throw new NotFoundException('Finance category not found');

    let attachmentUrl: string | null = null;
    let attachmentPublicId: string | null = null;
    let attachmentResourceType: string | null = null;
    if (attachment) {
      const uploaded = await this.cloudinaryService.uploadBuffer(
        attachment.buffer,
        'finance-requests',
        `${user.id}-${Date.now()}`,
        attachment.mimetype,
      );
      attachmentUrl = uploaded.secureUrl;
      attachmentPublicId = uploaded.publicId;
      attachmentResourceType = uploaded.resourceType;
    }

    const request = await this.requestRepo.save(
      this.requestRepo.create({
        requestedBy: { id: user.id },
        department: { id: dto.departmentId },
        category: { id: dto.categoryId },
        reason: dto.reason,
        amount: dto.amount,
        recipientBankName: dto.recipientBankName,
        recipientAccountNumber: dto.recipientAccountNumber,
        recipientAccountName: dto.recipientAccountName,
        attachmentUrl,
        attachmentPublicId,
        attachmentResourceType,
      }),
    );

    this.auditLogService.log('FINANCE_REQUEST_CREATED', {
      actorId: user.id,
      metadata: { requestId: request.id, amount: dto.amount },
    });
    this.notifyFinanceTeam(request).catch((err) =>
      this.logger.error(`Finance team notification failed: ${err.message}`),
    );

    return request;
  }

  async getMyDepartmentRequests(
    departmentId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginationResponseDto<FinanceRequest>> {
    const [data, total] = await this.requestRepo.findAndCount({
      where: { department: { id: departmentId } },
      relations: ['category', 'reviewedBy', 'reviewedBy.member'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  // ── Requests (Admin/Finance Team) ─────────────────────────────────────────

  async getAllRequests(
    page = 1,
    limit = 20,
    status?: FinanceRequestStatus,
    categoryId?: string,
    memberId?: string,
    departmentId?: string,
    search?: string,
  ): Promise<PaginationResponseDto<FinanceRequest>> {
    const qb = this.buildRequestsQb(
      status,
      categoryId,
      memberId,
      departmentId,
      search,
    );
    const [data, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async getRequestsExcel(
    status?: FinanceRequestStatus,
    categoryId?: string,
    memberId?: string,
    departmentId?: string,
    search?: string,
  ): Promise<Buffer> {
    const requests = await this.buildRequestsQb(
      status,
      categoryId,
      memberId,
      departmentId,
      search,
    ).getMany();
    return this.excelService.buildWorkbook(
      'Finance Requests',
      [
        { header: 'Requester', key: 'requester', width: 28 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Department', key: 'department', width: 22 },
        { header: 'Category', key: 'category', width: 20 },
        { header: `Amount (${this.currencyCode})`, key: 'amount', width: 18 },
        { header: 'Status', key: 'status', width: 14 },
        { header: 'Reason', key: 'reason', width: 40 },
        { header: 'Reviewed By', key: 'reviewedBy', width: 24 },
        { header: 'Reviewed At', key: 'reviewedAt', width: 18 },
        { header: 'Rejection Reason', key: 'rejectionReason', width: 35 },
      ],
      requests.map((r) => ({
        requester: `${r.requestedBy.firstname} ${r.requestedBy.lastname}`,
        email: r.requestedBy.email,
        department: r.department?.name ?? '',
        category: r.category?.name ?? '',
        amount: Number(r.amount),
        status: r.status,
        reason: r.reason,
        reviewedBy: r.reviewedBy?.member
          ? `${r.reviewedBy.member.firstname} ${r.reviewedBy.member.lastname}`
          : '',
        reviewedAt: r.reviewedAt
          ? new Date(r.reviewedAt).toISOString().slice(0, 10)
          : '',
        rejectionReason: r.rejectionReason ?? '',
      })),
    );
  }

  private buildRequestsQb(
    status?: FinanceRequestStatus,
    categoryId?: string,
    memberId?: string,
    departmentId?: string,
    search?: string,
  ) {
    const qb = this.requestRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.requestedBy', 'requestedBy')
      .leftJoinAndSelect('r.department', 'department')
      .leftJoinAndSelect('r.category', 'category')
      .leftJoinAndSelect('r.reviewedBy', 'reviewedBy')
      .leftJoinAndSelect('reviewedBy.member', 'reviewedByMember')
      .orderBy('r.createdAt', 'DESC');

    if (status) qb.andWhere('r.status = :status', { status });
    if (categoryId) qb.andWhere('category.id = :categoryId', { categoryId });
    if (memberId) qb.andWhere('requestedBy.id = :memberId', { memberId });
    if (departmentId)
      qb.andWhere('department.id = :departmentId', { departmentId });
    if (search) {
      qb.andWhere(
        '(LOWER(requestedBy.firstname) LIKE :s OR LOWER(requestedBy.lastname) LIKE :s OR LOWER(requestedBy.email) LIKE :s OR LOWER(r.reason) LIKE :s)',
        { s: `%${search.toLowerCase()}%` },
      );
    }

    return qb;
  }

  async getRequest(id: string): Promise<FinanceRequest> {
    const request = await this.requestRepo.findOne({
      where: { id },
      relations: [
        'requestedBy',
        'department',
        'category',
        'reviewedBy',
        'reviewedBy.member',
      ],
    });
    if (!request) throw new NotFoundException('Finance request not found');
    return request;
  }

  async approveRequest(id: string, actorAdmin: Admin): Promise<void> {
    const request = await this.getRequest(id);
    if (request.status !== FinanceRequestStatus.PENDING) {
      throw new BadRequestException('Only pending requests can be approved');
    }
    if (request.requestedBy?.id === actorAdmin.member?.id) {
      throw new ForbiddenException(
        'You cannot approve your own finance request',
      );
    }

    request.status = FinanceRequestStatus.APPROVED;
    request.reviewedBy = actorAdmin;
    request.reviewedAt = new Date();
    await this.requestRepo.save(request);

    this.auditLogService.log('FINANCE_REQUEST_APPROVED', {
      actorId: actorAdmin.member?.id,
      metadata: { requestId: id },
    });
    this.notifyHod(request, 'approved').catch((err) =>
      this.logger.error(`HOD notification failed: ${err.message}`),
    );
  }

  async rejectRequest(
    id: string,
    dto: RejectFinanceRequestDto,
    actorAdmin: Admin,
  ): Promise<void> {
    const request = await this.getRequest(id);
    if (request.status !== FinanceRequestStatus.PENDING) {
      throw new BadRequestException('Only pending requests can be rejected');
    }

    request.status = FinanceRequestStatus.REJECTED;
    request.reviewedBy = actorAdmin;
    request.reviewedAt = new Date();
    request.rejectionReason = dto.rejectionReason;
    await this.requestRepo.save(request);

    this.auditLogService.log('FINANCE_REQUEST_REJECTED', {
      actorId: actorAdmin.member?.id,
      metadata: { requestId: id, reason: dto.rejectionReason },
    });
    this.notifyHod(request, 'rejected').catch((err) =>
      this.logger.error(`HOD notification failed: ${err.message}`),
    );
  }

  async attachProof(
    id: string,
    file: Express.Multer.File,
    actorAdmin: Admin,
  ): Promise<void> {
    const request = await this.getRequest(id);
    if (request.status !== FinanceRequestStatus.APPROVED) {
      throw new BadRequestException(
        'Proof can only be attached to approved requests',
      );
    }
    if (!file) throw new BadRequestException('Proof file is required');

    if (request.proofPublicId) {
      try {
        await this.cloudinaryService.deleteByPublicId(
          request.proofPublicId,
          request.proofResourceType,
        );
      } catch (err) {
        this.logger.error(
          `Failed to delete old proof asset ${request.proofPublicId}: ${err.message}`,
        );
      }
    }

    const uploaded = await this.cloudinaryService.uploadBuffer(
      file.buffer,
      'finance-proofs',
      `${id}-proof-${Date.now()}`,
      file.mimetype,
    );

    request.proofUrl = uploaded.secureUrl;
    request.proofPublicId = uploaded.publicId;
    request.proofResourceType = uploaded.resourceType;
    await this.requestRepo.save(request);

    this.auditLogService.log('FINANCE_PROOF_ATTACHED', {
      actorId: actorAdmin.member?.id,
      metadata: { requestId: id },
    });
    this.notifyHod(request, 'proof').catch((err) =>
      this.logger.error(`HOD notification failed: ${err.message}`),
    );
  }

  // ── Notifications ─────────────────────────────────────────────────────────

  private async notifyFinanceTeam(request: FinanceRequest): Promise<void> {
    const admins = await this.adminRepo
      .createQueryBuilder('a')
      .innerJoinAndSelect('a.member', 'm')
      .innerJoin('a.adminRole', 'r')
      .where('a.isActive = true')
      .andWhere(':perm = ANY(r.permissions)', {
        perm: AdminPermission.FINANCE_WRITE,
      })
      .getMany();

    for (const admin of admins) {
      if (!admin.member?.email) continue;
      this.utilityService.sendEmailWithTemplate(
        admin.member.email,
        'New Finance Request Pending Review',
        'finance-request-submitted',
        {
          amount: `${this.currencyCode} ${Number(request.amount).toLocaleString(this.currencyLocale)}`,
          reason: request.reason,
          requestId: request.id,
        },
      );
    }
  }

  private async notifyHod(
    request: FinanceRequest,
    event: 'approved' | 'rejected' | 'proof',
  ): Promise<void> {
    const hod = await this.requestRepo.findOne({
      where: { id: request.id },
      relations: ['requestedBy'],
    });
    if (!hod?.requestedBy?.email) return;

    const templates: Record<string, string> = {
      approved: 'finance-request-approved',
      rejected: 'finance-request-rejected',
      proof: 'finance-proof-attached',
    };

    const subjects: Record<string, string> = {
      approved: 'Your Finance Request Has Been Approved',
      rejected: 'Your Finance Request Was Not Approved',
      proof: 'Payment Proof Attached to Your Finance Request',
    };

    this.utilityService.sendEmailWithTemplate(
      hod.requestedBy.email,
      subjects[event],
      templates[event],
      {
        name: UtilityService.capitalizeFirstLetter(hod.requestedBy.firstname),
        amount: `${this.currencyCode} ${Number(request.amount).toLocaleString(this.currencyLocale)}`,
        reason: request.reason,
        rejectionReason: request.rejectionReason ?? '',
        proofUrl: request.proofUrl ?? '',
      },
    );
  }
}
