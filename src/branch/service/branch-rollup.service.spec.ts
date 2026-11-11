import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';

import { BranchRollupService } from './branch-rollup.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { TenantRollup } from '../entity/tenant-rollup.entity';
import { Member } from '../../member/entity/member.entity';
import { Attendance } from '../../attendance/entity/attendance.entity';
import { TitheRecord } from '../../tithe/entity/tithe-record.entity';
import { Subscription } from '../../billing/entity/subscription.entity';
import { CacheService } from '../../utility/service/cache.service';

const mockTenantRepo = {
  find: jest.fn(),
  findOne: jest.fn().mockResolvedValue({ orgType: 'CHURCH' }),
  findOneBy: jest.fn(),
  findOneByOrFail: jest.fn(),
  findOneOrFail: jest.fn(),
  update: jest.fn(),
  save: jest.fn(),
};
const mockRollupRepo = { save: jest.fn(), findBy: jest.fn() };
const mockMemberRepo = { count: jest.fn() };
const mockSubscriptionRepo = { findOneBy: jest.fn(), save: jest.fn() };
const mockCacheService = { del: jest.fn() };

function mockQueryBuilder(raw: any) {
  return {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(raw),
  };
}

const mockAttendanceRepo = { createQueryBuilder: jest.fn() };
const mockTitheRecordRepo = { createQueryBuilder: jest.fn() };

// Real runWith/withTransaction set up AsyncLocalStorage + a DB transaction —
// neither is what this spec is testing (trusted elsewhere, e.g. the YouTube
// live detection spec's identical mock) — just invoking the callback is
// enough to verify tenant context is entered before computing stats.
const mockCls = { get: jest.fn(), runWith: jest.fn((_store, fn) => fn()) };
const mockTxHost = {
  tx: { query: jest.fn() },
  withTransaction: jest.fn((fn) => fn()),
};

describe('BranchRollupService', () => {
  let service: BranchRollupService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCls.runWith.mockImplementation((_store, fn) => fn());
    mockTxHost.withTransaction.mockImplementation((fn) => fn());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BranchRollupService,
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: getRepositoryToken(TenantRollup), useValue: mockRollupRepo },
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        {
          provide: getRepositoryToken(Attendance),
          useValue: mockAttendanceRepo,
        },
        {
          provide: getRepositoryToken(TitheRecord),
          useValue: mockTitheRecordRepo,
        },
        {
          provide: getRepositoryToken(Subscription),
          useValue: mockSubscriptionRepo,
        },
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();
    service = module.get(BranchRollupService);
  });

  describe('computeAndUpsertOne', () => {
    it('enters the tenant context, computes stats, and upserts the public rollup row', async () => {
      mockMemberRepo.count.mockResolvedValue(120);
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder({ total: '100', attended: '80' }),
      );
      mockTitheRecordRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder({ total: '500000.00' }),
      );
      mockRollupRepo.save.mockResolvedValue({});

      await service.computeAndUpsertOne({
        id: 'tenant-1',
        schemaName: 'church_test',
      } as any);

      expect(mockCls.runWith).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          schemaName: 'church_test',
        }),
        expect.any(Function),
      );
      expect(mockTxHost.tx.query).toHaveBeenCalledWith(
        expect.stringContaining('SET LOCAL search_path'),
      );
      expect(mockRollupRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          memberCount: 120,
          attendanceRate: 80, // 80/100 * 100
          totalGiving: 500000,
        }),
      );
    });

    it('records a null attendanceRate when there are no attendance rows in the window', async () => {
      mockMemberRepo.count.mockResolvedValue(10);
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder({ total: '0', attended: '0' }),
      );
      mockTitheRecordRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder({ total: '0' }),
      );
      mockRollupRepo.save.mockResolvedValue({});

      await service.computeAndUpsertOne({
        id: 'tenant-2',
        schemaName: 'church_two',
      } as any);

      expect(mockRollupRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ attendanceRate: null, totalGiving: 0 }),
      );
    });
  });

  describe('giving sharing', () => {
    it("reads and sets only this church's own choice", async () => {
      mockCls.get.mockReturnValue('branch-1');
      mockTenantRepo.findOneOrFail.mockResolvedValue({
        id: 'branch-1',
        shareGivingWithParent: false,
      });
      mockTenantRepo.update.mockResolvedValue(undefined);

      await expect(service.getGivingSharing()).resolves.toEqual({
        shareGivingWithParent: false,
      });
      await expect(service.setGivingSharing(true)).resolves.toEqual({
        shareGivingWithParent: true,
      });
      expect(mockTenantRepo.update).toHaveBeenCalledWith('branch-1', {
        shareGivingWithParent: true,
      });
    });
  });
});
