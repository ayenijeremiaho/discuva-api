import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
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
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
        { provide: ExcelService, useValue: mockExcelService },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: TenantCurrencyService,
          useValue: mockTenantCurrencyService,
        },
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
        service.attachProof('req-1', file, mockAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when no file is provided', async () => {
      mockRequestRepo.findOne.mockResolvedValue(approvedRequest);

      await expect(
        service.attachProof('req-1', undefined as any, mockAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('should upload to Cloudinary and save proofUrl', async () => {
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

      await service.attachProof('req-1', file, mockAdmin);

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
    });
  });
});
