import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BranchRollupService } from './branch-rollup.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { TenantRollup } from '../entity/tenant-rollup.entity';
import { Member } from '../../member/entity/member.entity';
import { Attendance } from '../../attendance/entity/attendance.entity';
import { TitheRecord } from '../../tithe/entity/tithe-record.entity';
import { Subscription } from '../../billing/entity/subscription.entity';
import { SubscriptionStatus } from '../../billing/enum/subscription-status.enum';
import { CacheService } from '../../utility/service/cache.service';

const mockTenantRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  findOneByOrFail: jest.fn(),
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

  describe('getOverview', () => {
    it('throws when called with no tenant in CLS', async () => {
      mockCls.get.mockReturnValue(undefined);
      await expect(service.getOverview()).rejects.toThrow(ForbiddenException);
    });

    it('returns an empty array when this tenant has no branches', async () => {
      mockCls.get.mockReturnValue('parent-1');
      mockTenantRepo.find.mockResolvedValue([]);
      expect(await service.getOverview()).toEqual([]);
      expect(mockRollupRepo.findBy).not.toHaveBeenCalled();
    });

    it('joins each branch with its rollup, defaulting missing rollups to zero/null', async () => {
      mockCls.get.mockReturnValue('parent-1');
      mockTenantRepo.find.mockResolvedValue([
        {
          id: 'branch-1',
          name: 'Branch One',
          subdomain: 'branch-one',
          shareDataWithParent: true,
          shareGivingWithParent: true,
        },
        {
          id: 'branch-2',
          name: 'Branch Two',
          subdomain: 'branch-two',
          shareDataWithParent: true,
          shareGivingWithParent: false,
        },
      ]);
      mockRollupRepo.findBy.mockResolvedValue([
        {
          tenantId: 'branch-1',
          memberCount: 50,
          attendanceRate: 75,
          totalGiving: 100000,
          computedAt: new Date('2026-08-01'),
        },
      ]);

      const result = await service.getOverview();

      expect(result).toEqual([
        expect.objectContaining({
          tenantId: 'branch-1',
          memberCount: 50,
          totalGiving: 100000,
          sharingEnabled: true,
          givingShared: true,
        }),
        expect.objectContaining({
          tenantId: 'branch-2',
          memberCount: 0,
          attendanceRate: null,
          totalGiving: null,
          computedAt: null,
          sharingEnabled: true,
          givingShared: false,
        }),
      ]);
    });

    it('nulls out every stat for a branch that has not consented to share data at all', async () => {
      mockCls.get.mockReturnValue('parent-1');
      mockTenantRepo.find.mockResolvedValue([
        {
          id: 'branch-1',
          name: 'Branch One',
          subdomain: 'branch-one',
          shareDataWithParent: false,
          shareGivingWithParent: false,
        },
      ]);
      mockRollupRepo.findBy.mockResolvedValue([
        {
          tenantId: 'branch-1',
          memberCount: 50,
          attendanceRate: 75,
          totalGiving: 100000,
          computedAt: new Date('2026-08-01'),
        },
      ]);

      const result = await service.getOverview();

      expect(result).toEqual([
        {
          tenantId: 'branch-1',
          name: 'Branch One',
          subdomain: 'branch-one',
          memberCount: null,
          attendanceRate: null,
          totalGiving: null,
          computedAt: null,
          sharingEnabled: false,
          givingShared: false,
        },
      ]);
    });

    it('shares engagement but hides giving when shareGivingWithParent is false', async () => {
      mockCls.get.mockReturnValue('parent-1');
      mockTenantRepo.find.mockResolvedValue([
        {
          id: 'branch-1',
          name: 'Branch One',
          subdomain: 'branch-one',
          shareDataWithParent: true,
          shareGivingWithParent: false,
        },
      ]);
      mockRollupRepo.findBy.mockResolvedValue([
        {
          tenantId: 'branch-1',
          memberCount: 50,
          attendanceRate: 75,
          totalGiving: 100000,
          computedAt: new Date('2026-08-01'),
        },
      ]);

      const result = await service.getOverview();

      expect(result[0].memberCount).toBe(50);
      expect(result[0].totalGiving).toBeNull();
    });
  });

  describe('getSharingConsent', () => {
    it('returns the current tenant sharing flags with no parent info when not a branch', async () => {
      mockCls.get.mockReturnValue('tenant-1');
      mockTenantRepo.findOneByOrFail.mockResolvedValue({
        shareDataWithParent: true,
        shareGivingWithParent: false,
        parentTenantId: null,
      });
      const result = await service.getSharingConsent();
      expect(result).toEqual({
        shareDataWithParent: true,
        shareGivingWithParent: false,
        parentTenantId: null,
        parentTenantName: null,
      });
      expect(mockTenantRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('resolves and returns the parent tenant name when this tenant is a branch', async () => {
      mockCls.get.mockReturnValue('tenant-1');
      mockTenantRepo.findOneByOrFail.mockResolvedValue({
        shareDataWithParent: true,
        shareGivingWithParent: false,
        parentTenantId: 'parent-1',
      });
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'parent-1',
        name: 'Parent Church',
      });

      const result = await service.getSharingConsent();

      expect(mockTenantRepo.findOneBy).toHaveBeenCalledWith({
        id: 'parent-1',
      });
      expect(result).toEqual({
        shareDataWithParent: true,
        shareGivingWithParent: false,
        parentTenantId: 'parent-1',
        parentTenantName: 'Parent Church',
      });
    });
  });

  describe('updateSharingConsent', () => {
    it('applies only the provided fields', async () => {
      mockCls.get.mockReturnValue('tenant-1');
      mockTenantRepo.findOneByOrFail.mockResolvedValue({
        shareDataWithParent: true,
        shareGivingWithParent: false,
        parentTenantId: null,
      });
      mockTenantRepo.save.mockImplementation((t) => t);

      const result = await service.updateSharingConsent({
        shareGivingWithParent: true,
      });

      expect(result).toEqual({
        shareDataWithParent: true,
        shareGivingWithParent: true,
        parentTenantId: null,
        parentTenantName: null,
      });
    });
  });

  describe('unlinkBranch', () => {
    it('throws NotFoundException when the branch is not linked to this tenant', async () => {
      mockCls.get.mockReturnValue('parent-1');
      mockTenantRepo.findOneBy.mockResolvedValue(null);
      await expect(service.unlinkBranch('branch-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('nulls parentTenantId and revokes a sponsorship from this parent', async () => {
      mockCls.get.mockReturnValue('parent-1');
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'branch-1',
        parentTenantId: 'parent-1',
      });
      mockTenantRepo.save.mockResolvedValue({});
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        tenantId: 'branch-1',
        planId: 'pro',
        sponsoredByTenantId: 'parent-1',
      });
      mockSubscriptionRepo.save.mockResolvedValue({});

      await service.unlinkBranch('branch-1');

      expect(mockTenantRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ parentTenantId: null }),
      );
      expect(mockSubscriptionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: 'free',
          status: SubscriptionStatus.CANCELED,
          sponsoredByTenantId: null,
        }),
      );
      expect(mockCacheService.del).toHaveBeenCalledWith(
        'plan-features:branch-1',
      );
    });

    it('leaves a non-sponsored subscription alone', async () => {
      mockCls.get.mockReturnValue('parent-1');
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'branch-1',
        parentTenantId: 'parent-1',
      });
      mockTenantRepo.save.mockResolvedValue({});
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        tenantId: 'branch-1',
        planId: 'pro',
        sponsoredByTenantId: null,
      });

      await service.unlinkBranch('branch-1');
      expect(mockSubscriptionRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('leaveParent', () => {
    it('throws BadRequestException when this tenant has no parent', async () => {
      mockCls.get.mockReturnValue('tenant-1');
      mockTenantRepo.findOneByOrFail.mockResolvedValue({
        id: 'tenant-1',
        parentTenantId: null,
      });
      await expect(service.leaveParent()).rejects.toThrow(BadRequestException);
    });

    it('nulls its own parentTenantId and revokes sponsorship from the former parent', async () => {
      mockCls.get.mockReturnValue('tenant-1');
      mockTenantRepo.findOneByOrFail.mockResolvedValue({
        id: 'tenant-1',
        parentTenantId: 'parent-1',
      });
      mockTenantRepo.save.mockResolvedValue({});
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        tenantId: 'tenant-1',
        sponsoredByTenantId: 'parent-1',
      });
      mockSubscriptionRepo.save.mockResolvedValue({});

      await service.leaveParent();

      expect(mockTenantRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ parentTenantId: null }),
      );
      expect(mockSubscriptionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ sponsoredByTenantId: null }),
      );
    });
  });
});
