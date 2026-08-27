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
import { ClsService } from 'nestjs-cls';
import { FinanceCategory } from '../entity/finance-category.entity';
import { FinanceRequest } from '../entity/finance-request.entity';
import { FinanceRequestStatus } from '../enum/finance-request.enum';
import {
  AttachProofDto,
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
import { TenantCurrencyService } from '../../utility/service/tenant-currency.service';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { JournalEntry } from '../../finance/entity/journal-entry.entity';
import { JournalEntryLine } from '../../finance/entity/journal-entry-line.entity';
import { JournalEntryLink } from '../../finance/entity/journal-entry-link.entity';
import { AccountingPeriod } from '../../finance/entity/accounting-period.entity';
import { Account } from '../../finance/entity/account.entity';
import {
  AccountingPeriodStatus,
  JournalEntrySource,
  JournalEntryStatus,
  JournalEntryType,
  JournalLineType,
  JournalLinkRole,
  JournalLinkType,
} from '../../finance/enum/finance.enum';
import { PlanFeatureResolverService } from '../../billing/service/plan-feature-resolver.service';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';

@Injectable()
export class FinanceRequestService {
  private readonly logger = new Logger(FinanceRequestService.name);
  private readonly currencyLocale: string;

  constructor(
    @InjectRepository(FinanceCategory)
    private readonly categoryRepo: Repository<FinanceCategory>,
    @InjectRepository(FinanceRequest)
    private readonly requestRepo: Repository<FinanceRequest>,
    @InjectRepository(Admin)
    private readonly adminRepo: Repository<Admin>,
    @InjectRepository(JournalEntry)
    private readonly journalEntryRepo: Repository<JournalEntry>,
    @InjectRepository(JournalEntryLine)
    private readonly journalEntryLineRepo: Repository<JournalEntryLine>,
    @InjectRepository(JournalEntryLink)
    private readonly journalEntryLinkRepo: Repository<JournalEntryLink>,
    @InjectRepository(AccountingPeriod)
    private readonly periodRepo: Repository<AccountingPeriod>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly utilityService: UtilityService,
    private readonly auditLogService: AuditLogService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly excelService: ExcelService,
    private readonly config: ConfigService,
    private readonly tenantCurrencyService: TenantCurrencyService,
    private readonly planFeatureResolver: PlanFeatureResolverService,
    private readonly cls: ClsService<AppClsStore>,
  ) {
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
    const [requests, currencyCode] = await Promise.all([
      this.buildRequestsQb(
        status,
        categoryId,
        memberId,
        departmentId,
        search,
      ).getMany(),
      this.tenantCurrencyService.resolveCurrencyCode(),
    ]);
    return this.excelService.buildWorkbook(
      'Finance Requests',
      [
        { header: 'Requester', key: 'requester', width: 28 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Department', key: 'department', width: 22 },
        { header: 'Category', key: 'category', width: 20 },
        { header: `Amount (${currencyCode})`, key: 'amount', width: 18 },
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
        'journalEntry',
      ],
    });
    if (!request) throw new NotFoundException('Finance request not found');
    return request;
  }

  async approveRequest(id: string, actorAdmin: Admin): Promise<FinanceRequest> {
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
    const saved = await this.requestRepo.save(request);

    this.auditLogService.log('FINANCE_REQUEST_APPROVED', {
      actorId: actorAdmin.member?.id,
      metadata: { requestId: id },
    });
    this.notifyHod(request, 'approved').catch((err) =>
      this.logger.error(`HOD notification failed: ${err.message}`),
    );
    return saved;
  }

  async rejectRequest(
    id: string,
    dto: RejectFinanceRequestDto,
    actorAdmin: Admin,
  ): Promise<FinanceRequest> {
    const request = await this.getRequest(id);
    if (request.status !== FinanceRequestStatus.PENDING) {
      throw new BadRequestException('Only pending requests can be rejected');
    }

    request.status = FinanceRequestStatus.REJECTED;
    request.reviewedBy = actorAdmin;
    request.reviewedAt = new Date();
    request.rejectionReason = dto.rejectionReason;
    const saved = await this.requestRepo.save(request);

    this.auditLogService.log('FINANCE_REQUEST_REJECTED', {
      actorId: actorAdmin.member?.id,
      metadata: { requestId: id, reason: dto.rejectionReason },
    });
    this.notifyHod(request, 'rejected').catch((err) =>
      this.logger.error(`HOD notification failed: ${err.message}`),
    );
    return saved;
  }

  async attachProof(
    id: string,
    file: Express.Multer.File,
    dto: AttachProofDto,
    actorAdmin: Admin,
  ): Promise<FinanceRequest> {
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

    if (dto.postToJournal) {
      await this.postFinanceRequestToJournal(request, dto, actorAdmin);
    }

    const saved = await this.requestRepo.save(request);

    this.auditLogService.log('FINANCE_PROOF_ATTACHED', {
      actorId: actorAdmin.member?.id,
      metadata: { requestId: id, postedToJournal: !!dto.postToJournal },
    });
    this.notifyHod(request, 'proof').catch((err) =>
      this.logger.error(`HOD notification failed: ${err.message}`),
    );
    return saved;
  }

  // Mirrors PettyCashService.approve(): creates a PENDING_APPROVAL journal
  // entry, not POSTED — a second, different admin must still approve it via
  // JournalEntryController before it affects Account.currentBalance.
  // Deliberately NOT wrapped in DataSource.transaction() — every repo here
  // comes from TenantTypeOrmModule.forFeature(), which is already bound to
  // the one per-request transaction TenantMiddleware opens (with the
  // correct tenant search_path already set), so this is already atomic.
  private async postFinanceRequestToJournal(
    request: FinanceRequest,
    dto: AttachProofDto,
    actorAdmin: Admin,
  ): Promise<void> {
    const tenantId = this.cls.get('tenantId');
    if (tenantId) {
      const { features } = await this.planFeatureResolver.resolve(tenantId);
      if (!features.includes(PlanFeature.FINANCE)) {
        throw new ForbiddenException({
          message: 'Posting to the journal requires an upgraded plan.',
          code: 'PLAN_UPGRADE_REQUIRED',
          requiredFeature: PlanFeature.FINANCE,
        });
      }
    }

    const idempotencyKey = `finance-request:${request.id}`;
    const [existing, period] = await Promise.all([
      this.journalEntryRepo.findOne({ where: { idempotencyKey } }),
      this.periodRepo.findOne({
        where: {
          year: new Date().getFullYear(),
          month: new Date().getMonth() + 1,
          status: AccountingPeriodStatus.OPEN,
        },
      }),
    ]);
    if (existing) {
      // Idempotent no-op — re-posting an already-posted request just
      // re-links it rather than erroring or duplicating the entry.
      request.journalEntry = existing;
      return;
    }
    if (!period) {
      throw new BadRequestException(
        'No open accounting period for the current month — cannot post to the journal.',
      );
    }

    const [debit, credit] = await Promise.all([
      this.accountRepo.findOne({ where: { id: dto.debitAccountId } }),
      this.accountRepo.findOne({ where: { id: dto.creditAccountId } }),
    ]);
    if (!debit || !credit) {
      throw new NotFoundException('One or both accounts not found.');
    }
    if (!debit.isActive || !credit.isActive) {
      throw new BadRequestException('Both accounts must be active.');
    }
    if (debit.id === credit.id) {
      throw new BadRequestException('Debit and credit accounts must differ.');
    }

    const entry = this.journalEntryRepo.create({
      date: new Date().toISOString().split('T')[0],
      description: `Finance request payment: ${request.reason} (${request.department?.name ?? ''})`,
      reference: request.id,
      source: JournalEntrySource.FINANCE_REQUEST,
      entryType: JournalEntryType.STANDARD,
      status: JournalEntryStatus.PENDING_APPROVAL,
      idempotencyKey,
      accountingPeriod: { id: period.id } as AccountingPeriod,
      createdBy: { id: actorAdmin.id } as Admin,
    });
    const savedEntry = await this.journalEntryRepo.save(entry);

    await this.journalEntryLineRepo.save([
      this.journalEntryLineRepo.create({
        journalEntry: { id: savedEntry.id } as JournalEntry,
        account: { id: debit.id } as Account,
        entryType: JournalLineType.DEBIT,
        amount: request.amount,
      }),
      this.journalEntryLineRepo.create({
        journalEntry: { id: savedEntry.id } as JournalEntry,
        account: { id: credit.id } as Account,
        entryType: JournalLineType.CREDIT,
        amount: request.amount,
      }),
    ]);

    await this.journalEntryLinkRepo.save(
      this.journalEntryLinkRepo.create({
        journalEntry: { id: savedEntry.id } as JournalEntry,
        linkType: JournalLinkType.FINANCE_REQUEST,
        role: JournalLinkRole.RECIPIENT,
        financeRequestId: request.id,
      }),
    );

    request.journalEntry = savedEntry;
  }

  // ── Notifications ─────────────────────────────────────────────────────────

  private async notifyFinanceTeam(request: FinanceRequest): Promise<void> {
    const [admins, currencyCode] = await Promise.all([
      this.adminRepo
        .createQueryBuilder('a')
        .innerJoinAndSelect('a.member', 'm')
        .innerJoin('a.adminRole', 'r')
        .where('a.isActive = true')
        .andWhere(':perm = ANY(r.permissions)', {
          perm: AdminPermission.FINANCE_WRITE,
        })
        .getMany(),
      this.tenantCurrencyService.resolveCurrencyCode(),
    ]);

    for (const admin of admins) {
      if (!admin.member?.email) continue;
      this.utilityService.sendEmailWithTemplate(
        admin.member.email,
        'New Finance Request Pending Review',
        'finance-request-submitted',
        {
          amount: `${currencyCode} ${Number(request.amount).toLocaleString(this.currencyLocale)}`,
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
    const [hod, currencyCode] = await Promise.all([
      this.requestRepo.findOne({
        where: { id: request.id },
        relations: ['requestedBy'],
      }),
      this.tenantCurrencyService.resolveCurrencyCode(),
    ]);
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
        amount: `${currencyCode} ${Number(request.amount).toLocaleString(this.currencyLocale)}`,
        reason: request.reason,
        rejectionReason: request.rejectionReason ?? '',
        proofUrl: request.proofUrl ?? '',
      },
    );
  }
}
