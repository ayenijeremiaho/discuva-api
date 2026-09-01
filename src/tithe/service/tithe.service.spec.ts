import ExcelJS from 'exceljs';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TitheService } from './tithe.service';
import { TitheUploadBatch } from '../entity/tithe-upload-batch.entity';
import { TitheRecord } from '../entity/tithe-record.entity';
import { TitheUnmatchedRecord } from '../entity/tithe-unmatched-record.entity';
import { TitheDisputeRecord } from '../entity/tithe-dispute-record.entity';
import {
  TitheBatchStatus,
  TitheDisputeStatus,
  TitheProofStatus,
  TitheUnmatchedStatus,
} from '../enum/tithe.enum';
import { TITHE_QUEUE } from '../processor/tithe.processor';
import { TithePaymentProof } from '../entity/tithe-payment-proof.entity';
import { TitheAccount } from '../entity/tithe-account.entity';
import { Member } from '../../member/entity/member.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import { CacheService } from '../../utility/service/cache.service';
import { PdfService } from '../../utility/service/pdf.service';
import { ExcelService } from '../../utility/service/excel.service';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { SessionSurface } from '../../auth/enum/session-surface.enum';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';

const mockClsService = {
  get: jest.fn(),
  isActive: jest.fn().mockReturnValue(false),
  getId: jest.fn(),
  runWith: jest.fn((_store: unknown, fn: () => unknown) => fn()),
};

const mockTenantRepo = {
  find: jest
    .fn()
    .mockResolvedValue([{ id: 't1', subdomain: 'a', schemaName: 'church_a' }]),
};
const mockTxHost = {
  tx: { query: jest.fn() },
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};

const mockAccountRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockBatchRepo = {
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
};

const mockRecordRepo = {
  find: jest.fn(),
  findAndCount: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockUnmatchedRepo = {
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockDisputeRepo = {
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockMemberRepo = {
  findOne: jest.fn(),
};

const mockProofRepo = {
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
};

const mockAdminRepo = {
  createQueryBuilder: jest.fn(),
};

const mockTitheQueue = {
  add: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };

const mockUtilityService = {
  sendEmailWithTemplate: jest.fn(),
  sendEmailWithAttachment: jest.fn(),
};

const mockCloudinaryService = {
  uploadBuffer: jest.fn(),
  deleteByPublicId: jest.fn(),
};

const mockCacheService = {
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn(),
};

const mockPdfService = {
  generateTitheStatement: jest.fn().mockResolvedValue(Buffer.from('pdf')),
};

const mockExcelService = {
  buildWorkbook: jest.fn().mockResolvedValue(Buffer.from('xlsx')),
};

const mockConfigService = {
  get: jest
    .fn()
    .mockImplementation((_key: string, defaultValue?: string) => defaultValue),
};

const mockAdmin = {
  id: 'admin-1',
  member: { id: 'member-admin-1', email: 'admin@test.com', firstname: 'Admin' },
} as unknown as Admin;

const mockMember = {
  id: 'member-1',
  firstname: 'John',
  lastname: 'Doe',
  email: 'john@test.com',
  phoneNumber: null,
} as Member;

const mockUser = {
  id: 'member-1',
  role: MemberRoleEnum.MEMBER,
  requiresPasswordChange: false,
  surface: SessionSurface.MEMBER,
};

function makeRecordsQb(rows: object[], total: number) {
  const qb: any = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
    getManyAndCount: jest.fn().mockResolvedValue([rows, total]),
  };
  mockRecordRepo.createQueryBuilder.mockReturnValue(qb);
  return qb;
}

function makeUnmatchedQb(rows: object[], total: number) {
  const qb: any = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([rows, total]),
  };
  mockUnmatchedRepo.createQueryBuilder.mockReturnValue(qb);
  return qb;
}

function makeDisputeQb(rows: object[], total: number) {
  const qb: any = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([rows, total]),
  };
  mockDisputeRepo.createQueryBuilder.mockReturnValue(qb);
  return qb;
}

describe('TitheService', () => {
  let service: TitheService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TitheService,
        {
          provide: getRepositoryToken(TitheAccount),
          useValue: mockAccountRepo,
        },
        {
          provide: getRepositoryToken(TitheUploadBatch),
          useValue: mockBatchRepo,
        },
        { provide: getRepositoryToken(TitheRecord), useValue: mockRecordRepo },
        {
          provide: getRepositoryToken(TitheUnmatchedRecord),
          useValue: mockUnmatchedRepo,
        },
        {
          provide: getRepositoryToken(TitheDisputeRecord),
          useValue: mockDisputeRepo,
        },
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        {
          provide: getRepositoryToken(TithePaymentProof),
          useValue: mockProofRepo,
        },
        { provide: getRepositoryToken(Admin), useValue: mockAdminRepo },
        { provide: getQueueToken(TITHE_QUEUE), useValue: mockTitheQueue },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: PdfService, useValue: mockPdfService },
        { provide: ExcelService, useValue: mockExcelService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ClsService, useValue: mockClsService },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: TransactionHost, useValue: mockTxHost },
      ],
    }).compile();

    service = module.get<TitheService>(TitheService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── uploadBatch ───────────────────────────────────────────────────────────

  describe('uploadBatch', () => {
    const buildXlsx = async (
      rows: Record<string, any>[],
      headers?: string[],
    ) => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Sheet1');
      const cols = headers ?? [
        'email',
        'amount',
        'paymentDate',
        'reference',
        'bankName',
      ];
      sheet.addRow(cols);
      rows.forEach((r) => sheet.addRow(cols.map((c) => r[c] ?? '')));
      const buf = await workbook.xlsx.writeBuffer();
      return {
        buffer: Buffer.from(buf),
        originalname: 'test.xlsx',
      } as Express.Multer.File;
    };

    const mockAccount = {
      id: 'account-1',
      bankName: 'GTBank',
      accountName: 'Church Account',
      currency: 'NGN',
      isActive: true,
    };

    it('should throw BadRequestException when required column is missing', async () => {
      const file = await buildXlsx([], ['name', 'amount']);
      mockAccountRepo.findOne.mockResolvedValue(mockAccount);

      await expect(
        service.uploadBatch(file, mockAdmin, 'account-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when file has no valid data rows', async () => {
      const file = await buildXlsx([]);
      mockAccountRepo.findOne.mockResolvedValue(mockAccount);

      await expect(
        service.uploadBatch(file, mockAdmin, 'account-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create batch, add job to queue, and return batch id and row count', async () => {
      const file = await buildXlsx([
        { email: 'a@test.com', amount: 5000, paymentDate: '2026-01-01' },
        { email: 'b@test.com', amount: 2000, paymentDate: '2026-01-01' },
      ]);

      mockAccountRepo.findOne.mockResolvedValue(mockAccount);
      const batch = {
        id: 'batch-1',
        status: TitheBatchStatus.PENDING,
        totalRows: 2,
      };
      mockBatchRepo.create.mockReturnValue(batch);
      mockBatchRepo.save.mockResolvedValue(batch);
      mockTitheQueue.add.mockResolvedValue({});

      const result = await service.uploadBatch(file, mockAdmin, 'account-1');

      expect(result.batchId).toBe('batch-1');
      expect(result.totalRows).toBe(2);
      expect(mockTitheQueue.add).toHaveBeenCalledWith(
        'process-batch',
        expect.objectContaining({
          batchId: 'batch-1',
          rows: expect.arrayContaining([
            expect.objectContaining({ email: 'a@test.com', amount: 5000 }),
          ]),
        }),
        expect.any(Object),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'TITHE_BATCH_QUEUED',
        expect.objectContaining({
          metadata: expect.objectContaining({ rows: 2 }),
        }),
      );
    });

    it('should skip rows missing required fields', async () => {
      const file = await buildXlsx([
        { email: 'a@test.com', amount: 5000, paymentDate: '2026-01-01' },
        { email: '', amount: 2000, paymentDate: '2026-01-01' },
        { email: 'c@test.com', amount: Number.NaN, paymentDate: '2026-01-01' },
      ]);

      mockAccountRepo.findOne.mockResolvedValue(mockAccount);
      const batch = {
        id: 'batch-1',
        status: TitheBatchStatus.PENDING,
        totalRows: 1,
      };
      mockBatchRepo.create.mockReturnValue(batch);
      mockBatchRepo.save.mockResolvedValue(batch);
      mockTitheQueue.add.mockResolvedValue({});

      const result = await service.uploadBatch(file, mockAdmin, 'account-1');

      expect(result.totalRows).toBe(1);
    });
  });

  // ── getBatch ──────────────────────────────────────────────────────────────

  describe('getBatch', () => {
    it('should throw NotFoundException when batch does not exist', async () => {
      mockBatchRepo.findOne.mockResolvedValue(null);

      await expect(service.getBatch('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return batch when found', async () => {
      const batch = { id: 'batch-1', status: TitheBatchStatus.COMPLETED };
      mockBatchRepo.findOne.mockResolvedValue(batch);

      const result = await service.getBatch('batch-1');

      expect(result).toEqual(batch);
    });
  });

  // ── requeueBatch ──────────────────────────────────────────────────────────

  describe('requeueBatch', () => {
    it('should throw NotFoundException when no failed batch exists with given id', async () => {
      mockBatchRepo.findOne.mockResolvedValue(null);

      await expect(service.requeueBatch('batch-1', mockAdmin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when batch has no stored rows', async () => {
      mockBatchRepo.findOne.mockResolvedValue({
        id: 'batch-1',
        status: TitheBatchStatus.FAILED,
        rows: null,
      });

      await expect(service.requeueBatch('batch-1', mockAdmin)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reset status to PENDING, requeue the job, and log audit event', async () => {
      const storedRows = [
        { email: 'a@test.com', amount: 5000, paymentDate: '2026-01-01' },
      ];
      mockBatchRepo.findOne.mockResolvedValue({
        id: 'batch-1',
        status: TitheBatchStatus.FAILED,
        rows: storedRows,
      });
      mockTitheQueue.add.mockResolvedValue({});

      await service.requeueBatch('batch-1', mockAdmin);

      expect(mockBatchRepo.update).toHaveBeenCalledWith('batch-1', {
        status: TitheBatchStatus.PENDING,
        errorMessage: null,
        processedAt: null,
      });
      expect(mockTitheQueue.add).toHaveBeenCalledWith(
        'process-batch',
        expect.objectContaining({ batchId: 'batch-1', rows: storedRows }),
        expect.any(Object),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'TITHE_BATCH_QUEUED',
        expect.objectContaining({
          metadata: expect.objectContaining({
            batchId: 'batch-1',
            requeue: true,
          }),
        }),
      );
    });
  });

  // ── matchUnmatched ────────────────────────────────────────────────────────

  describe('matchUnmatched', () => {
    const unmatchedRecord = {
      id: 'um-1',
      status: TitheUnmatchedStatus.PENDING,
      batch: { id: 'batch-1' },
      amount: 3000,
      paymentDate: '2026-01-01',
      reference: null,
      bankName: null,
    };

    it('should throw NotFoundException when unmatched record does not exist', async () => {
      mockUnmatchedRepo.findOne.mockResolvedValue(null);

      await expect(
        service.matchUnmatched('um-1', 'member-1', mockAdmin),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when target member does not exist', async () => {
      mockUnmatchedRepo.findOne.mockResolvedValue(unmatchedRecord);
      mockMemberRepo.findOne.mockResolvedValue(null);

      await expect(
        service.matchUnmatched('um-1', 'member-nonexistent', mockAdmin),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create TitheRecord, mark unmatched as MATCHED, and log audit event', async () => {
      mockUnmatchedRepo.findOne.mockResolvedValue({ ...unmatchedRecord });
      mockMemberRepo.findOne.mockResolvedValue(mockMember);
      mockRecordRepo.create.mockReturnValue({});
      mockRecordRepo.save.mockResolvedValue({});
      mockUnmatchedRepo.save.mockResolvedValue({});

      await service.matchUnmatched('um-1', 'member-1', mockAdmin);

      expect(mockRecordRepo.save).toHaveBeenCalled();
      expect(mockUnmatchedRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: TitheUnmatchedStatus.MATCHED,
          matchedMember: mockMember,
          resolvedBy: mockAdmin,
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'TITHE_UNMATCHED_RESOLVED',
        expect.objectContaining({ actorId: 'member-admin-1' }),
      );
    });
  });

  // ── approveDispute ────────────────────────────────────────────────────────

  describe('approveDispute', () => {
    const dispute = {
      id: 'disp-1',
      status: TitheDisputeStatus.PENDING,
      member: { id: 'member-1' },
      batch: { id: 'batch-1' },
      amount: 5000,
      paymentDate: '2026-01-01',
      reference: null,
      bankName: null,
    };

    it('should throw NotFoundException when dispute does not exist', async () => {
      mockDisputeRepo.findOne.mockResolvedValue(null);

      await expect(service.approveDispute('disp-1', mockAdmin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should create TitheRecord, mark dispute as CONFIRMED_VALID, and log audit event', async () => {
      mockDisputeRepo.findOne.mockResolvedValue({ ...dispute });
      mockRecordRepo.create.mockReturnValue({});
      mockRecordRepo.save.mockResolvedValue({});
      mockDisputeRepo.save.mockResolvedValue({});

      await service.approveDispute('disp-1', mockAdmin);

      expect(mockRecordRepo.save).toHaveBeenCalled();
      expect(mockDisputeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: TitheDisputeStatus.CONFIRMED_VALID,
          reviewedBy: mockAdmin,
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'TITHE_DISPUTE_APPROVED',
        expect.objectContaining({ actorId: 'member-admin-1' }),
      );
    });
  });

  // ── rejectDispute ─────────────────────────────────────────────────────────

  describe('rejectDispute', () => {
    it('should throw NotFoundException when dispute does not exist', async () => {
      mockDisputeRepo.findOne.mockResolvedValue(null);

      await expect(service.rejectDispute('disp-1', mockAdmin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should mark dispute as REJECTED and log audit event', async () => {
      const dispute = { id: 'disp-1', status: TitheDisputeStatus.PENDING };
      mockDisputeRepo.findOne.mockResolvedValue({ ...dispute });
      mockDisputeRepo.save.mockResolvedValue({});

      await service.rejectDispute('disp-1', mockAdmin);

      expect(mockDisputeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: TitheDisputeStatus.REJECTED,
          reviewedBy: mockAdmin,
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'TITHE_DISPUTE_REJECTED',
        expect.objectContaining({ actorId: 'member-admin-1' }),
      );
    });
  });

  // ── dismissUnmatched ──────────────────────────────────────────────────────

  describe('dismissUnmatched', () => {
    it('should throw NotFoundException when record does not exist or already resolved', async () => {
      mockUnmatchedRepo.findOne.mockResolvedValue(null);

      await expect(service.dismissUnmatched('um-1', mockAdmin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should mark record as DISMISSED, set resolver, and log audit event', async () => {
      const record = { id: 'um-1', status: TitheUnmatchedStatus.PENDING };
      mockUnmatchedRepo.findOne.mockResolvedValue({ ...record });
      mockUnmatchedRepo.save.mockResolvedValue({});

      await service.dismissUnmatched('um-1', mockAdmin);

      expect(mockUnmatchedRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: TitheUnmatchedStatus.DISMISSED,
          resolvedBy: mockAdmin,
          resolvedAt: expect.any(Date),
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'TITHE_UNMATCHED_DISMISSED',
        expect.objectContaining({ actorId: 'member-admin-1' }),
      );
    });
  });

  // ── getUnmatched with status filter ───────────────────────────────────────

  describe('getUnmatched', () => {
    it('should default to PENDING status when no filter provided', async () => {
      const qb = makeUnmatchedQb([], 0);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [],
        page: 1,
        limit: 20,
        totalCount: 0,
        totalPages: 0,
      });

      await service.getUnmatched(1, 20);

      expect(qb.where).toHaveBeenCalledWith('u.status = :status', {
        status: TitheUnmatchedStatus.PENDING,
      });
    });

    it('should filter by provided status', async () => {
      const qb = makeUnmatchedQb([], 0);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [],
        page: 1,
        limit: 20,
        totalCount: 0,
        totalPages: 0,
      });

      await service.getUnmatched(1, 20, TitheUnmatchedStatus.MATCHED);

      expect(qb.where).toHaveBeenCalledWith('u.status = :status', {
        status: TitheUnmatchedStatus.MATCHED,
      });
    });
  });

  // ── getDisputes with status filter ────────────────────────────────────────

  describe('getDisputes', () => {
    it('should default to PENDING status when no filter provided', async () => {
      const qb = makeDisputeQb([], 0);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [],
        page: 1,
        limit: 20,
        totalCount: 0,
        totalPages: 0,
      });

      await service.getDisputes(1, 20);

      expect(qb.where).toHaveBeenCalledWith('d.status = :status', {
        status: TitheDisputeStatus.PENDING,
      });
    });

    it('should filter by provided status', async () => {
      const qb = makeDisputeQb([], 0);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [],
        page: 1,
        limit: 20,
        totalCount: 0,
        totalPages: 0,
      });

      await service.getDisputes(1, 20, TitheDisputeStatus.CONFIRMED_VALID);

      expect(qb.where).toHaveBeenCalledWith('d.status = :status', {
        status: TitheDisputeStatus.CONFIRMED_VALID,
      });
    });
  });

  // ── getMyTithes ───────────────────────────────────────────────────────────

  describe('getMyTithes', () => {
    it('should return paginated tithe records for the member', async () => {
      const records = [{ id: 'rec-1', amount: 5000 }];
      mockRecordRepo.findAndCount.mockResolvedValue([records, 1]);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: records as any,
        page: 1,
        limit: 20,
        totalCount: 1,
        totalPages: 1,
      });

      const result = await service.getMyTithes(mockUser, 1, 20);

      expect(mockRecordRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { member: { id: 'member-1' } } }),
      );
      expect(result.totalCount).toBe(1);
    });
  });

  // ── submitProof ───────────────────────────────────────────────────────────

  describe('submitProof', () => {
    const mockAccount = {
      id: 'account-1',
      bankName: 'GTBank',
      accountName: 'Church Account',
      currency: 'NGN',
      isActive: true,
    };
    const dto = {
      titheAccountId: 'account-1',
      amount: 5000,
      paymentDate: '2026-01-01',
      reference: 'TRF001',
    };
    const file = {
      buffer: Buffer.from('proof'),
      originalname: 'proof.jpg',
      size: 1024,
      mimetype: 'image/jpeg',
    };
    const uploadResult = {
      secureUrl: 'https://cdn.example.com/proof.jpg',
      publicId: 'tithe-proofs/proof',
      resourceType: 'image',
    };

    it('should throw BadRequestException when file exceeds 5MB', async () => {
      const bigFile = {
        buffer: Buffer.alloc(1),
        originalname: 'big.pdf',
        size: 6 * 1024 * 1024,
        mimetype: 'application/pdf',
      };

      await expect(service.submitProof(mockUser, dto, bigFile)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should upload proof, save record, and notify finance team', async () => {
      mockAccountRepo.findOne.mockResolvedValue(mockAccount);
      mockCloudinaryService.uploadBuffer.mockResolvedValue(uploadResult);
      const savedProof = {
        id: 'proof-1',
        ...dto,
        titheAccount: mockAccount,
        proofUrl: uploadResult.secureUrl,
        publicId: uploadResult.publicId,
        resourceType: uploadResult.resourceType,
      };
      mockProofRepo.create.mockReturnValue(savedProof);
      mockProofRepo.save.mockResolvedValue(savedProof);
      const adminQb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      mockAdminRepo.createQueryBuilder.mockReturnValue(adminQb);

      const result = await service.submitProof(mockUser, dto, file);

      expect(mockCloudinaryService.uploadBuffer).toHaveBeenCalledWith(
        file.buffer,
        'tithe-proofs',
        expect.stringContaining('member-1'),
        'image/jpeg',
      );
      expect(mockProofRepo.save).toHaveBeenCalled();
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'TITHE_PROOF_SUBMITTED',
        expect.any(Object),
      );
      expect(result).toEqual(savedProof);
    });
  });

  // ── confirmProof ──────────────────────────────────────────────────────────

  describe('confirmProof', () => {
    it('should throw NotFoundException when pending proof not found', async () => {
      mockProofRepo.findOne.mockResolvedValue(null);

      await expect(service.confirmProof('proof-1', mockAdmin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should set status CONFIRMED, save, and email member', async () => {
      const proof = {
        id: 'proof-1',
        status: TitheProofStatus.PENDING,
        member: mockMember,
        titheAccount: { currency: 'NGN' },
        amount: 5000,
        paymentDate: '2026-01-01',
      };
      mockProofRepo.findOne.mockResolvedValue(proof);
      mockProofRepo.save.mockResolvedValue({
        ...proof,
        status: TitheProofStatus.CONFIRMED,
      });

      await service.confirmProof('proof-1', mockAdmin);

      expect(mockProofRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: TitheProofStatus.CONFIRMED,
          reviewedBy: mockAdmin,
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'TITHE_PROOF_CONFIRMED',
        expect.any(Object),
      );
      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
        mockMember.email,
        expect.any(String),
        'tithe-proof-confirmed',
        expect.any(Object),
        undefined,
        'GIVING_RECEIPT',
      );
    });
  });

  // ── declineProof ──────────────────────────────────────────────────────────

  describe('declineProof', () => {
    it('should throw NotFoundException when pending proof not found', async () => {
      mockProofRepo.findOne.mockResolvedValue(null);

      await expect(
        service.declineProof(
          'proof-1',
          { financeNote: 'Not received' },
          mockAdmin,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should set status DECLINED, save note, and email member', async () => {
      const proof = {
        id: 'proof-1',
        status: TitheProofStatus.PENDING,
        member: mockMember,
        titheAccount: { currency: 'NGN' },
        amount: 5000,
        paymentDate: '2026-01-01',
      };
      mockProofRepo.findOne.mockResolvedValue(proof);
      mockProofRepo.save.mockResolvedValue({
        ...proof,
        status: TitheProofStatus.DECLINED,
      });

      await service.declineProof(
        'proof-1',
        { financeNote: 'Contact your bank' },
        mockAdmin,
      );

      expect(mockProofRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: TitheProofStatus.DECLINED,
          financeNote: 'Contact your bank',
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'TITHE_PROOF_DECLINED',
        expect.any(Object),
      );
      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
        mockMember.email,
        expect.any(String),
        'tithe-proof-declined',
        expect.objectContaining({ financeNote: 'Contact your bank' }),
        undefined,
        'GIVING_RECEIPT',
      );
    });
  });

  // ── purgeExpiredProofs ────────────────────────────────────────────────────

  describe('purgeExpiredProofs', () => {
    it('should skip when lock is not acquired', async () => {
      mockCacheService.acquireLock.mockResolvedValue(false);

      await service.purgeExpiredProofs();

      expect(mockProofRepo.find).not.toHaveBeenCalled();
    });

    it('should delete expired proofs from Cloudinary and DB', async () => {
      const expired = [
        { id: 'proof-1', publicId: 'tithe-proofs/p1', resourceType: 'image' },
        { id: 'proof-2', publicId: 'tithe-proofs/p2', resourceType: 'raw' },
      ];
      mockCacheService.acquireLock.mockResolvedValue(true);
      mockProofRepo.find.mockResolvedValue(expired);
      mockProofRepo.remove.mockResolvedValue({});

      await service.purgeExpiredProofs();

      expect(mockCloudinaryService.deleteByPublicId).toHaveBeenCalledTimes(2);
      expect(mockProofRepo.remove).toHaveBeenCalledTimes(2);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'TITHE_PROOF_EXPIRED_PURGED',
        expect.any(Object),
      );
      expect(mockCacheService.releaseLock).toHaveBeenCalled();
    });

    it('runs the purge once per active tenant, entering each tenant context', async () => {
      mockTenantRepo.find.mockResolvedValue([
        { id: 't1', subdomain: 'a', schemaName: 'church_a' },
        { id: 't2', subdomain: 'b', schemaName: 'church_b' },
      ]);
      mockCacheService.acquireLock.mockResolvedValue(true);
      mockProofRepo.find.mockResolvedValue([]);

      await service.purgeExpiredProofs();

      expect(mockProofRepo.find).toHaveBeenCalledTimes(2);
      expect(mockTxHost.tx.query).toHaveBeenCalledWith(
        'SET LOCAL search_path TO "church_a", public',
      );
      expect(mockTxHost.tx.query).toHaveBeenCalledWith(
        'SET LOCAL search_path TO "church_b", public',
      );
    });

    it('continues purging other tenants when one tenant fails', async () => {
      mockTenantRepo.find.mockResolvedValue([
        { id: 't1', subdomain: 'a', schemaName: 'church_a' },
        { id: 't2', subdomain: 'b', schemaName: 'church_b' },
      ]);
      mockCacheService.acquireLock.mockResolvedValue(true);
      mockProofRepo.find
        .mockRejectedValueOnce(new Error('db error'))
        .mockResolvedValueOnce([]);

      await service.purgeExpiredProofs();

      expect(mockProofRepo.find).toHaveBeenCalledTimes(2);
      expect(mockCacheService.releaseLock).toHaveBeenCalled();
    });
  });

  // ── getAdminRecords ───────────────────────────────────────────────────────

  describe('getAdminRecords', () => {
    it('should return paginated records with no filters', async () => {
      const records = [
        {
          id: 'r-1',
          amount: 5000,
          paymentDate: '2026-01-01',
          member: { firstname: 'John', lastname: 'Doe', email: 'j@test.com' },
        },
      ];
      const qb = makeRecordsQb(records, 1);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: records as any,
        page: 1,
        limit: 20,
        totalCount: 1,
        totalPages: 1,
      });

      const result = await service.getAdminRecords(1, 20);

      expect(qb.getManyAndCount).toHaveBeenCalled();
      expect(result.totalCount).toBe(1);
    });

    it('should apply memberId filter', async () => {
      const qb = makeRecordsQb([], 0);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [],
        page: 1,
        limit: 20,
        totalCount: 0,
        totalPages: 0,
      });

      await service.getAdminRecords(1, 20, { memberId: 'member-1' });

      expect(qb.andWhere).toHaveBeenCalledWith('member.id = :memberId', {
        memberId: 'member-1',
      });
    });

    it('should apply departmentId filter', async () => {
      const qb = makeRecordsQb([], 0);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [],
        page: 1,
        limit: 20,
        totalCount: 0,
        totalPages: 0,
      });

      await service.getAdminRecords(1, 20, { departmentId: 'dept-1' });

      expect(qb.andWhere).toHaveBeenCalledWith('dept.id = :departmentId', {
        departmentId: 'dept-1',
      });
    });

    it('should apply search filter on member name, email, and both reference fields', async () => {
      const qb = makeRecordsQb([], 0);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [],
        page: 1,
        limit: 20,
        totalCount: 0,
        totalPages: 0,
      });

      await service.getAdminRecords(1, 20, { search: 'john' });

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('LOWER(member.firstname)'),
        expect.objectContaining({ s: '%john%' }),
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('LOWER(r.reference)'),
        expect.objectContaining({ s: '%john%' }),
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('LOWER(r.external_reference)'),
        expect.objectContaining({ s: '%john%' }),
      );
    });
  });

  // ── getAdminRecordsExcel ──────────────────────────────────────────────────

  describe('getAdminRecordsExcel', () => {
    it('should return an Excel buffer with the correct columns', async () => {
      const records = [
        {
          id: 'r-1',
          amount: 5000,
          paymentDate: '2026-01-01',
          bankName: 'GTB',
          reference: 'REF1',
          source: 'PAYMENT_GATEWAY',
          paymentChannel: 'paystack',
          member: {
            firstname: 'Jane',
            lastname: 'Smith',
            email: 'jane@test.com',
          },
        },
      ];
      const qb: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(records),
        getManyAndCount: jest.fn().mockResolvedValue([records, 1]),
      };
      mockRecordRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getAdminRecordsExcel();

      expect(mockExcelService.buildWorkbook).toHaveBeenCalledWith(
        'Tithe Records',
        expect.arrayContaining([
          expect.objectContaining({ key: 'memberName' }),
          expect.objectContaining({ key: 'amount' }),
          expect.objectContaining({ key: 'source' }),
          expect.objectContaining({ key: 'paymentChannel' }),
        ]),
        expect.arrayContaining([
          expect.objectContaining({
            memberName: 'Jane Smith',
            email: 'jane@test.com',
            amount: 5000,
            source: 'PAYMENT_GATEWAY',
            paymentChannel: 'paystack',
          }),
        ]),
      );
      expect(result).toBeInstanceOf(Buffer);
    });

    it('falls back to externalReference when reference is not set (gateway rows)', async () => {
      const records = [
        {
          id: 'r-2',
          amount: 2000,
          paymentDate: '2026-01-02',
          bankName: null,
          reference: null,
          externalReference: 'giving_abc123',
          source: 'PAYMENT_GATEWAY',
          paymentChannel: 'paystack',
          member: {
            firstname: 'John',
            lastname: 'Doe',
            email: 'john@test.com',
          },
        },
      ];
      const qb: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(records),
      };
      mockRecordRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getAdminRecordsExcel();

      expect(mockExcelService.buildWorkbook).toHaveBeenCalledWith(
        'Tithe Records',
        expect.any(Array),
        expect.arrayContaining([
          expect.objectContaining({ reference: 'giving_abc123' }),
        ]),
      );
    });
  });

  // ── emailTitheStatement ───────────────────────────────────────────────────

  describe('emailTitheStatement', () => {
    it('should throw NotFoundException when member does not exist', async () => {
      mockMemberRepo.findOne.mockResolvedValue(null);

      await expect(service.emailTitheStatement(mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should send email with tithe-statement template to the member', async () => {
      mockMemberRepo.findOne.mockResolvedValue(mockMember);
      mockRecordRepo.find.mockResolvedValue([
        {
          paymentDate: '2026-01-01',
          amount: 5000,
          bankName: null,
          reference: null,
        },
      ]);

      await service.emailTitheStatement(mockUser);

      expect(mockUtilityService.sendEmailWithAttachment).toHaveBeenCalledWith(
        'john@test.com',
        'Your Tithe Statement',
        'tithe-statement',
        expect.objectContaining({ name: 'John', period: undefined }),
        expect.arrayContaining([
          expect.objectContaining({ filename: 'tithe-statement.pdf' }),
        ]),
        'GIVING_RECEIPT',
      );
    });

    it('should include a human-readable period when fromMonth/toMonth are given', async () => {
      mockMemberRepo.findOne.mockResolvedValue(mockMember);
      mockRecordRepo.find.mockResolvedValue([]);

      await service.emailTitheStatement(mockUser, '2026-01', '2026-06');

      expect(mockUtilityService.sendEmailWithAttachment).toHaveBeenCalledWith(
        'john@test.com',
        'Your Tithe Statement',
        'tithe-statement',
        expect.objectContaining({ period: 'January 2026 – June 2026' }),
        expect.any(Array),
        'GIVING_RECEIPT',
      );
    });

    it('should format an open-ended "from" period', async () => {
      mockMemberRepo.findOne.mockResolvedValue(mockMember);
      mockRecordRepo.find.mockResolvedValue([]);

      await service.emailTitheStatement(mockUser, '2026-03', undefined);

      expect(mockUtilityService.sendEmailWithAttachment).toHaveBeenCalledWith(
        'john@test.com',
        'Your Tithe Statement',
        'tithe-statement',
        expect.objectContaining({ period: 'March 2026 onwards' }),
        expect.any(Array),
        'GIVING_RECEIPT',
      );
    });

    it('should return a confirmation message and record count instead of void', async () => {
      mockMemberRepo.findOne.mockResolvedValue(mockMember);
      mockRecordRepo.find.mockResolvedValue([
        {
          paymentDate: '2026-01-01',
          amount: 5000,
          bankName: null,
          reference: null,
        },
      ]);

      const result = await service.emailTitheStatement(mockUser);

      expect(result).toEqual({
        message: expect.stringContaining('john@test.com'),
        recordCount: 1,
      });
    });
  });
});
