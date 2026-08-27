import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FinanceRequestService } from './finance-request.service';
import { FinanceCategory } from '../entity/finance-category.entity';
import { FinanceRequest } from '../entity/finance-request.entity';
import { FinanceRequestStatus } from '../enum/finance-request.enum';
import { Admin } from '../../admin/entity/admin.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import { ExcelService } from '../../utility/service/excel.service';
import { TenantCurrencyService } from '../../utility/service/tenant-currency.service';
import { ConfigService } from '@nestjs/config';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { SessionSurface } from '../../auth/enum/session-surface.enum';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { ClsService } from 'nestjs-cls';
import { JournalEntry } from '../../finance/entity/journal-entry.entity';
import { JournalEntryLine } from '../../finance/entity/journal-entry-line.entity';
import { JournalEntryLink } from '../../finance/entity/journal-entry-link.entity';
import { AccountingPeriod } from '../../finance/entity/accounting-period.entity';
import { Account } from '../../finance/entity/account.entity';
import { PlanFeatureResolverService } from '../../billing/service/plan-feature-resolver.service';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import {
  AccountingPeriodStatus,
  JournalEntryStatus,
} from '../../finance/enum/finance.enum';

const mockCategoryRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const makeQb = () => ({
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  innerJoinAndSelect: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn(),
  getMany: jest.fn(),
});

const mockRequestRepo = {
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockAdminRepo = {
  createQueryBuilder: jest.fn(),
};

const mockJournalEntryRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const mockJournalEntryLineRepo = {
  create: jest.fn(),
  save: jest.fn(),
};

const mockJournalEntryLinkRepo = {
  create: jest.fn(),
  save: jest.fn(),
};

const mockPeriodRepo = {
  findOne: jest.fn(),
};

const mockAccountRepo = {
  findOne: jest.fn(),
};

const mockPlanFeatureResolver = {
  resolve: jest.fn(),
};

const mockCls = {
  get: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };

const mockConfigService = {
  get: jest
    .fn()
    .mockImplementation((_key: string, defaultValue?: string) => defaultValue),
};

const mockCloudinaryService = {
  uploadBuffer: jest.fn(),
};

const mockExcelService = {
  buildWorkbook: jest.fn().mockResolvedValue(Buffer.from('xlsx')),
};

const mockUtilityService = {
  sendEmailWithTemplate: jest.fn(),
};

const mockTenantCurrencyService = {
  resolveCurrencyCode: jest.fn().mockResolvedValue('NGN'),
};

const mockAdmin = {
  id: 'admin-1',
  isActive: true,
  member: { id: 'member-admin-1', email: 'admin@test.com', firstname: 'Admin' },
  adminRole: { permissions: [AdminPermission.FINANCE_WRITE] },
} as unknown as Admin;

const mockUser = {
  id: 'member-1',
  role: MemberRoleEnum.WORKER,
  requiresPasswordChange: false,
  surface: SessionSurface.MEMBER,
};

const mockCategory = {
  id: 'cat-1',
  name: 'Equipment',
  description: 'Dept equipment',
};

const pendingRequest = {
  id: 'req-1',
  status: FinanceRequestStatus.PENDING,
  amount: 50000,
  reason: 'Buy projector',
  requestedBy: { id: 'member-1', email: 'hod@test.com', firstname: 'John' },
  department: { id: 'dept-1' },
  category: mockCategory,
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: null,
  proofUrl: null,
};

describe('FinanceRequestService', () => {
  let service: FinanceRequestService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCls.get.mockReturnValue('tenant-1');
    mockPlanFeatureResolver.resolve.mockResolvedValue({
      features: [PlanFeature.FINANCE],
      featureLimits: {},
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceRequestService,
        {
          provide: getRepositoryToken(FinanceCategory),
          useValue: mockCategoryRepo,
        },
        {
          provide: getRepositoryToken(FinanceRequest),
          useValue: mockRequestRepo,
        },
        { provide: getRepositoryToken(Admin), useValue: mockAdminRepo },
        {
          provide: getRepositoryToken(JournalEntry),
          useValue: mockJournalEntryRepo,
        },
        {
          provide: getRepositoryToken(JournalEntryLine),
          useValue: mockJournalEntryLineRepo,
        },
        {
          provide: getRepositoryToken(JournalEntryLink),
          useValue: mockJournalEntryLinkRepo,
        },
        {
          provide: getRepositoryToken(AccountingPeriod),
          useValue: mockPeriodRepo,
        },
        { provide: getRepositoryToken(Account), useValue: mockAccountRepo },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
        { provide: ExcelService, useValue: mockExcelService },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: TenantCurrencyService,
          useValue: mockTenantCurrencyService,
        },
        {
          provide: PlanFeatureResolverService,
          useValue: mockPlanFeatureResolver,
        },
        { provide: ClsService, useValue: mockCls },
      ],
    }).compile();

    service = module.get<FinanceRequestService>(FinanceRequestService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── Categories ────────────────────────────────────────────────────────────

  describe('getCategories', () => {
    it('should return all categories sorted by name', async () => {
      mockCategoryRepo.find.mockResolvedValue([mockCategory]);

      const result = await service.getCategories();

      expect(result).toEqual([mockCategory]);
      expect(mockCategoryRepo.find).toHaveBeenCalledWith({
        order: { name: 'ASC' },
      });
    });
  });

  describe('createCategory', () => {
    it('should throw ConflictException when name already exists', async () => {
      mockCategoryRepo.findOne.mockResolvedValue(mockCategory);

      await expect(
        service.createCategory({ name: 'Equipment' }, mockAdmin),
      ).rejects.toThrow(ConflictException);
    });

    it('should create and return category when name is unique', async () => {
      mockCategoryRepo.findOne.mockResolvedValue(null);
      mockCategoryRepo.create.mockReturnValue(mockCategory);
      mockCategoryRepo.save.mockResolvedValue(mockCategory);

      const result = await service.createCategory(
        { name: 'Equipment' },
        mockAdmin,
      );

      expect(result).toEqual(mockCategory);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'FINANCE_CATEGORY_CREATED',
        expect.objectContaining({ actorId: 'member-admin-1' }),
      );
    });
  });

  describe('updateCategory', () => {
    it('should throw NotFoundException when category does not exist', async () => {
      mockCategoryRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateCategory('nonexistent', { name: 'New' }, mockAdmin),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when new name already taken by another category', async () => {
      mockCategoryRepo.findOne
        .mockResolvedValueOnce(mockCategory)
        .mockResolvedValueOnce({ id: 'cat-2', name: 'Transport' });

      await expect(
        service.updateCategory('cat-1', { name: 'Transport' }, mockAdmin),
      ).rejects.toThrow(ConflictException);
    });

    it('should update category when name is unchanged', async () => {
      const category = { ...mockCategory };
      mockCategoryRepo.findOne.mockResolvedValue(category);
      mockCategoryRepo.save.mockResolvedValue({
        ...category,
        description: 'Updated',
      });

      const result = await service.updateCategory(
        'cat-1',
        { description: 'Updated' },
        mockAdmin,
      );

      expect(mockCategoryRepo.findOne).toHaveBeenCalledTimes(1);
      expect(result.description).toBe('Updated');
    });

    it('should update category when new name is unique', async () => {
      const category = { ...mockCategory };
      mockCategoryRepo.findOne
        .mockResolvedValueOnce(category)
        .mockResolvedValueOnce(null);
      mockCategoryRepo.save.mockResolvedValue({
        ...category,
        name: 'New Name',
      });

      const result = await service.updateCategory(
        'cat-1',
        { name: 'New Name' },
        mockAdmin,
      );

      expect(result.name).toBe('New Name');
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'FINANCE_CATEGORY_UPDATED',
        expect.objectContaining({ actorId: 'member-admin-1' }),
      );
    });
  });

  // ── Requests (HOD) ────────────────────────────────────────────────────────

  describe('createRequest', () => {
    const dto = {
      categoryId: 'cat-1',
      departmentId: 'dept-1',
      reason: 'Buy projector',
      amount: 50000,
      recipientBankName: 'GTB',
      recipientAccountNumber: '1234567890',
      recipientAccountName: 'Supplier Ltd',
    };

    it('should throw NotFoundException when category does not exist', async () => {
      mockCategoryRepo.findOne.mockResolvedValue(null);

      await expect(service.createRequest(dto, mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should create request without uploading attachment when no file provided', async () => {
      mockCategoryRepo.findOne.mockResolvedValue(mockCategory);
      mockRequestRepo.create.mockReturnValue(pendingRequest);
      mockRequestRepo.save.mockResolvedValue(pendingRequest);

      const adminQb = makeQb();
      adminQb.getMany.mockResolvedValue([]);
      mockAdminRepo.createQueryBuilder.mockReturnValue(adminQb);

      const result = await service.createRequest(dto, mockUser);

      expect(mockCloudinaryService.uploadBuffer).not.toHaveBeenCalled();
      expect(mockRequestRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ attachmentUrl: null }),
      );
      expect(result).toEqual(pendingRequest);
    });

    it('should upload attachment to Cloudinary when file is provided', async () => {
      mockCategoryRepo.findOne.mockResolvedValue(mockCategory);
      mockCloudinaryService.uploadBuffer.mockResolvedValue({
        secureUrl: 'https://res.cloudinary.com/test/file.pdf',
        publicId: 'finance-requests/file',
        resourceType: 'raw',
      });
      mockRequestRepo.create.mockReturnValue(pendingRequest);
      mockRequestRepo.save.mockResolvedValue(pendingRequest);

      const adminQb = makeQb();
      adminQb.getMany.mockResolvedValue([]);
      mockAdminRepo.createQueryBuilder.mockReturnValue(adminQb);

      const file = {
        buffer: Buffer.from('test'),
        originalname: 'budget.pdf',
        mimetype: 'application/pdf',
      } as Express.Multer.File;

      await service.createRequest(dto, mockUser, file);

      expect(mockCloudinaryService.uploadBuffer).toHaveBeenCalledWith(
        file.buffer,
        'finance-requests',
        expect.stringContaining('member-1'),
        'application/pdf',
      );
    });

    it('should log the audit event after saving', async () => {
      mockCategoryRepo.findOne.mockResolvedValue(mockCategory);
      mockRequestRepo.create.mockReturnValue(pendingRequest);
      mockRequestRepo.save.mockResolvedValue(pendingRequest);

      const adminQb = makeQb();
      adminQb.getMany.mockResolvedValue([]);
      mockAdminRepo.createQueryBuilder.mockReturnValue(adminQb);

      await service.createRequest(dto, mockUser);

      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'FINANCE_REQUEST_CREATED',
        expect.objectContaining({ actorId: 'member-1' }),
      );
    });

    it('should email finance team members who have FINANCE_WRITE permission', async () => {
      mockCategoryRepo.findOne.mockResolvedValue(mockCategory);
      mockRequestRepo.create.mockReturnValue(pendingRequest);
      mockRequestRepo.save.mockResolvedValue(pendingRequest);

      const adminQb = makeQb();
      adminQb.getMany.mockResolvedValue([mockAdmin]);
      mockAdminRepo.createQueryBuilder.mockReturnValue(adminQb);

      await service.createRequest(dto, mockUser);

      await new Promise(process.nextTick);

      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
        'admin@test.com',
        'New Finance Request Pending Review',
        'finance-request-submitted',
        expect.any(Object),
      );
    });

    it('should not email admins when no admins have FINANCE_WRITE permission', async () => {
      mockCategoryRepo.findOne.mockResolvedValue(mockCategory);
      mockRequestRepo.create.mockReturnValue(pendingRequest);
      mockRequestRepo.save.mockResolvedValue(pendingRequest);

      const adminQb = makeQb();
      adminQb.getMany.mockResolvedValue([]);
      mockAdminRepo.createQueryBuilder.mockReturnValue(adminQb);

      await service.createRequest(dto, mockUser);
      await new Promise(process.nextTick);

      expect(mockUtilityService.sendEmailWithTemplate).not.toHaveBeenCalled();
    });
  });

  // ── Requests (Admin) ──────────────────────────────────────────────────────

  describe('getRequest', () => {
    it('should throw NotFoundException when request does not exist', async () => {
      mockRequestRepo.findOne.mockResolvedValue(null);

      await expect(service.getRequest('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return the request when found', async () => {
      mockRequestRepo.findOne.mockResolvedValue(pendingRequest);

      const result = await service.getRequest('req-1');

      expect(result).toEqual(pendingRequest);
    });
  });

  describe('approveRequest', () => {
    it('should throw BadRequestException when request is not PENDING', async () => {
      mockRequestRepo.findOne.mockResolvedValue({
        ...pendingRequest,
        status: FinanceRequestStatus.APPROVED,
      });

      await expect(service.approveRequest('req-1', mockAdmin)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should set status to APPROVED and save', async () => {
      const request = { ...pendingRequest };
      mockRequestRepo.findOne
        .mockResolvedValueOnce(request)
        .mockResolvedValueOnce({
          ...request,
          requestedBy: { email: 'hod@test.com', firstname: 'John' },
        });
      mockRequestRepo.save.mockResolvedValue({
        ...request,
        status: FinanceRequestStatus.APPROVED,
      });

      await service.approveRequest('req-1', mockAdmin);

      expect(mockRequestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: FinanceRequestStatus.APPROVED,
          reviewedBy: mockAdmin,
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'FINANCE_REQUEST_APPROVED',
        expect.objectContaining({ actorId: 'member-admin-1' }),
      );
    });
  });

  describe('rejectRequest', () => {
    it('should throw BadRequestException when request is not PENDING', async () => {
      mockRequestRepo.findOne.mockResolvedValue({
        ...pendingRequest,
        status: FinanceRequestStatus.REJECTED,
      });

      await expect(
        service.rejectRequest(
          'req-1',
          { rejectionReason: 'No budget' },
          mockAdmin,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should set status to REJECTED with reason and save', async () => {
      const request = { ...pendingRequest };
      mockRequestRepo.findOne
        .mockResolvedValueOnce(request)
        .mockResolvedValueOnce({
          ...request,
          requestedBy: { email: 'hod@test.com', firstname: 'John' },
        });
      mockRequestRepo.save.mockResolvedValue(request);

      await service.rejectRequest(
        'req-1',
        { rejectionReason: 'No budget' },
        mockAdmin,
      );

      expect(mockRequestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: FinanceRequestStatus.REJECTED,
          rejectionReason: 'No budget',
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'FINANCE_REQUEST_REJECTED',
        expect.objectContaining({
          metadata: expect.objectContaining({ reason: 'No budget' }),
        }),
      );
    });
  });

  describe('getAllRequests', () => {
    it('should return paginated requests with no filters', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[pendingRequest], 1]);
      mockRequestRepo.createQueryBuilder.mockReturnValue(qb);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [pendingRequest] as any,
        page: 1,
        limit: 20,
        totalCount: 1,
        totalPages: 1,
      });

      const result = await service.getAllRequests(1, 20);

      expect(qb.getManyAndCount).toHaveBeenCalled();
      expect(result.totalCount).toBe(1);
    });

    it('should apply status filter', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      mockRequestRepo.createQueryBuilder.mockReturnValue(qb);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [],
        page: 1,
        limit: 20,
        totalCount: 0,
        totalPages: 0,
      });

      await service.getAllRequests(1, 20, FinanceRequestStatus.PENDING);

      expect(qb.andWhere).toHaveBeenCalledWith('r.status = :status', {
        status: FinanceRequestStatus.PENDING,
      });
    });

    it('should apply memberId filter', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      mockRequestRepo.createQueryBuilder.mockReturnValue(qb);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [],
        page: 1,
        limit: 20,
        totalCount: 0,
        totalPages: 0,
      });

      await service.getAllRequests(1, 20, undefined, undefined, 'member-1');

      expect(qb.andWhere).toHaveBeenCalledWith('requestedBy.id = :memberId', {
        memberId: 'member-1',
      });
    });

    it('should apply departmentId filter', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      mockRequestRepo.createQueryBuilder.mockReturnValue(qb);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [],
        page: 1,
        limit: 20,
        totalCount: 0,
        totalPages: 0,
      });

      await service.getAllRequests(
        1,
        20,
        undefined,
        undefined,
        undefined,
        'dept-1',
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        'department.id = :departmentId',
        { departmentId: 'dept-1' },
      );
    });

    it('should apply search filter across name, email, and reason', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      mockRequestRepo.createQueryBuilder.mockReturnValue(qb);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [],
        page: 1,
        limit: 20,
        totalCount: 0,
        totalPages: 0,
      });

      await service.getAllRequests(
        1,
        20,
        undefined,
        undefined,
        undefined,
        undefined,
        'projector',
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('LOWER(requestedBy.firstname)'),
        expect.objectContaining({ s: '%projector%' }),
      );
    });
  });

  describe('getRequestsExcel', () => {
    it('should return an Excel buffer with correct row shape', async () => {
      const request = {
        ...pendingRequest,
        requestedBy: {
          id: 'member-1',
          firstname: 'John',
          lastname: 'Doe',
          email: 'john@test.com',
        },
        department: { id: 'dept-1', name: 'Media' },
        category: { id: 'cat-1', name: 'Equipment' },
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
      };
      const qb = makeQb();
      qb.getMany.mockResolvedValue([request]);
      mockRequestRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getRequestsExcel();

      expect(mockExcelService.buildWorkbook).toHaveBeenCalledWith(
        'Finance Requests',
        expect.arrayContaining([
          expect.objectContaining({ key: 'requester' }),
          expect.objectContaining({ key: 'amount', header: 'Amount (NGN)' }),
          expect.objectContaining({ key: 'status' }),
        ]),
        expect.arrayContaining([
          expect.objectContaining({
            requester: 'John Doe',
            email: 'john@test.com',
            department: 'Media',
            amount: 50000,
          }),
        ]),
      );
      expect(result).toBeInstanceOf(Buffer);
      expect(mockTenantCurrencyService.resolveCurrencyCode).toHaveBeenCalled();
    });
  });

  describe('attachProof', () => {
    const approvedRequest = {
      ...pendingRequest,
      status: FinanceRequestStatus.APPROVED,
    };
    const file = {
      buffer: Buffer.from('proof'),
      originalname: 'proof.jpg',
      mimetype: 'image/jpeg',
    } as Express.Multer.File;

    it('should throw BadRequestException when request is not APPROVED', async () => {
      mockRequestRepo.findOne.mockResolvedValue(pendingRequest);

      await expect(
        service.attachProof('req-1', file, {}, mockAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when no file is provided', async () => {
      mockRequestRepo.findOne.mockResolvedValue(approvedRequest);

      await expect(
        service.attachProof('req-1', undefined as any, {}, mockAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('should upload to Cloudinary and save proofUrl when postToJournal is not set', async () => {
      const request = { ...approvedRequest };
      mockRequestRepo.findOne
        .mockResolvedValueOnce(request)
        .mockResolvedValueOnce({
          ...request,
          requestedBy: { email: 'hod@test.com', firstname: 'John' },
        });
      mockCloudinaryService.uploadBuffer.mockResolvedValue({
        secureUrl: 'https://res.cloudinary.com/proof.jpg',
        publicId: 'finance-proofs/req-1-proof',
        resourceType: 'image',
      });
      mockRequestRepo.save.mockResolvedValue(request);

      await service.attachProof('req-1', file, {}, mockAdmin);

      expect(mockCloudinaryService.uploadBuffer).toHaveBeenCalledWith(
        file.buffer,
        'finance-proofs',
        expect.stringContaining('req-1'),
        'image/jpeg',
      );
      expect(mockRequestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          proofUrl: 'https://res.cloudinary.com/proof.jpg',
          proofPublicId: 'finance-proofs/req-1-proof',
          proofResourceType: 'image',
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'FINANCE_PROOF_ATTACHED',
        expect.any(Object),
      );
      expect(mockJournalEntryRepo.save).not.toHaveBeenCalled();
    });

    // ── postToJournal ────────────────────────────────────────────────────────

    describe('postToJournal', () => {
      const postDto = {
        postToJournal: true,
        debitAccountId: 'acct-expense-1',
        creditAccountId: 'acct-bank-1',
      };
      const debitAccount = {
        id: 'acct-expense-1',
        isActive: true,
        type: 'EXPENSE',
      };
      const creditAccount = {
        id: 'acct-bank-1',
        isActive: true,
        type: 'ASSET',
      };
      const openPeriod = {
        id: 'period-1',
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1,
        status: AccountingPeriodStatus.OPEN,
      };

      beforeEach(() => {
        mockCloudinaryService.uploadBuffer.mockResolvedValue({
          secureUrl: 'https://res.cloudinary.com/proof.jpg',
          publicId: 'finance-proofs/req-1-proof',
          resourceType: 'image',
        });
        mockRequestRepo.save.mockImplementation((r: any) => Promise.resolve(r));
      });

      it('throws ForbiddenException when the tenant plan lacks FINANCE', async () => {
        mockRequestRepo.findOne.mockResolvedValueOnce({ ...approvedRequest });
        mockPlanFeatureResolver.resolve.mockResolvedValue({
          features: [],
          featureLimits: {},
        });

        await expect(
          service.attachProof('req-1', file, postDto, mockAdmin),
        ).rejects.toThrow(ForbiddenException);
      });

      it('throws BadRequestException when no accounting period is open', async () => {
        mockRequestRepo.findOne.mockResolvedValueOnce({ ...approvedRequest });
        mockJournalEntryRepo.findOne.mockResolvedValue(null);
        mockPeriodRepo.findOne.mockResolvedValue(null);

        await expect(
          service.attachProof('req-1', file, postDto, mockAdmin),
        ).rejects.toThrow(BadRequestException);
      });

      it('throws NotFoundException when an account does not exist', async () => {
        mockRequestRepo.findOne.mockResolvedValueOnce({ ...approvedRequest });
        mockJournalEntryRepo.findOne.mockResolvedValue(null);
        mockPeriodRepo.findOne.mockResolvedValue(openPeriod);
        mockAccountRepo.findOne
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(creditAccount);

        await expect(
          service.attachProof('req-1', file, postDto, mockAdmin),
        ).rejects.toThrow(NotFoundException);
      });

      it('throws BadRequestException when debit and credit accounts are the same', async () => {
        mockRequestRepo.findOne.mockResolvedValueOnce({ ...approvedRequest });
        mockJournalEntryRepo.findOne.mockResolvedValue(null);
        mockPeriodRepo.findOne.mockResolvedValue(openPeriod);
        mockAccountRepo.findOne
          .mockResolvedValueOnce(debitAccount)
          .mockResolvedValueOnce(debitAccount);

        await expect(
          service.attachProof('req-1', file, postDto, mockAdmin),
        ).rejects.toThrow(BadRequestException);
      });

      it('creates a PENDING_APPROVAL journal entry with debit/credit lines and a link back to the request', async () => {
        const request = { ...approvedRequest, amount: 50000 };
        mockRequestRepo.findOne.mockResolvedValueOnce(request);
        mockJournalEntryRepo.findOne.mockResolvedValue(null);
        mockPeriodRepo.findOne.mockResolvedValue(openPeriod);
        mockAccountRepo.findOne
          .mockResolvedValueOnce(debitAccount)
          .mockResolvedValueOnce(creditAccount);
        const savedEntry = {
          id: 'entry-1',
          status: JournalEntryStatus.PENDING_APPROVAL,
        };
        mockJournalEntryRepo.create.mockReturnValue({
          idempotencyKey: 'finance-request:req-1',
        });
        mockJournalEntryRepo.save.mockResolvedValue(savedEntry);
        mockJournalEntryLineRepo.create.mockImplementation((v: any) => v);
        mockJournalEntryLinkRepo.create.mockImplementation((v: any) => v);

        const result = await service.attachProof(
          'req-1',
          file,
          postDto,
          mockAdmin,
        );

        expect(mockJournalEntryRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            idempotencyKey: 'finance-request:req-1',
          }),
        );
        expect(mockJournalEntryLineRepo.save).toHaveBeenCalledWith([
          expect.objectContaining({ entryType: 'DEBIT', amount: 50000 }),
          expect.objectContaining({ entryType: 'CREDIT', amount: 50000 }),
        ]);
        expect(mockJournalEntryLinkRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            linkType: 'FINANCE_REQUEST',
            financeRequestId: 'req-1',
          }),
        );
        expect(result.journalEntry).toEqual(savedEntry);
      });

      it('is idempotent — re-linking an already-posted request without creating a duplicate entry', async () => {
        const existingEntry = { id: 'entry-existing' };
        mockRequestRepo.findOne.mockResolvedValueOnce({ ...approvedRequest });
        mockJournalEntryRepo.findOne.mockResolvedValue(existingEntry);

        const result = await service.attachProof(
          'req-1',
          file,
          postDto,
          mockAdmin,
        );

        expect(mockJournalEntryRepo.save).not.toHaveBeenCalled();
        expect(result.journalEntry).toEqual(existingEntry);
      });
    });
  });
});
