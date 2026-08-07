import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { OverdueCheckoutScheduler } from './overdue-checkout.scheduler';
import { AssetCheckout } from '../entity/asset-checkout.entity';
import { AssetCheckoutNotification } from '../entity/asset-checkout-notification.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { Member } from '../../member/entity/member.entity';
import { DepartmentLead } from '../../department/entity/department-lead.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { CacheService } from '../../utility/service/cache.service';

const makeAdminQb = (admins: object[]) => ({
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue(admins),
});

const mockCheckoutRepo = { find: jest.fn().mockResolvedValue([]) };
const mockNotificationRepo = {
  find: jest.fn().mockResolvedValue([]),
  save: jest.fn(),
};
const mockAdminRepo = { createQueryBuilder: jest.fn() };
const mockMemberRepo = { findOne: jest.fn() };
const mockDepartmentLeadRepo = { find: jest.fn().mockResolvedValue([]) };
const mockTenantRepo = { find: jest.fn() };
const mockUtilityService = { sendEmailWithTemplate: jest.fn() };
const mockCacheService = {
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn(),
};
const mockConfigService = { get: jest.fn().mockReturnValue('1,3,7') };
const mockCls = {
  runWith: jest.fn((_store: unknown, fn: () => unknown) => fn()),
};
const mockTxHost = {
  tx: { query: jest.fn() },
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};

describe('OverdueCheckoutScheduler', () => {
  let scheduler: OverdueCheckoutScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCheckoutRepo.find.mockResolvedValue([]);
    mockNotificationRepo.find.mockResolvedValue([]);
    mockAdminRepo.createQueryBuilder.mockReturnValue(makeAdminQb([]));
    mockCacheService.acquireLock.mockResolvedValue(true);
    mockConfigService.get.mockReturnValue('1,3,7');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverdueCheckoutScheduler,
        {
          provide: getRepositoryToken(AssetCheckout),
          useValue: mockCheckoutRepo,
        },
        {
          provide: getRepositoryToken(AssetCheckoutNotification),
          useValue: mockNotificationRepo,
        },
        { provide: getRepositoryToken(Admin), useValue: mockAdminRepo },
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        {
          provide: getRepositoryToken(DepartmentLead),
          useValue: mockDepartmentLeadRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
      ],
    }).compile();
    scheduler = module.get(OverdueCheckoutScheduler);
  });

  it('runs the checkout query once per active tenant, entering each tenant context', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);

    await scheduler.dispatchOverdueReminders();

    expect(mockCheckoutRepo.find).toHaveBeenCalledTimes(2);
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_a", public',
    );
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_b", public',
    );
  });

  it('emails the checked-out member when a checkout crosses a threshold', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    const expectedReturnAt = new Date();
    expectedReturnAt.setDate(expectedReturnAt.getDate() - 3);
    const checkout = {
      id: 'checkout-1',
      expectedReturnAt,
      checkedOutAt: new Date(),
      asset: { name: 'Projector', tagNumber: 'AST-1' },
      checkedOutToMember: { id: 'member-1' },
      checkedOutToDepartment: null,
      purpose: null,
    };
    mockCheckoutRepo.find.mockResolvedValue([checkout]);
    mockMemberRepo.findOne.mockResolvedValue({
      id: 'member-1',
      email: 'w@example.com',
      firstname: 'Ada',
      lastname: 'Lovelace',
    });

    await scheduler.dispatchOverdueReminders();

    expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
      'w@example.com',
      expect.stringContaining('Overdue Asset Reminder'),
      'asset-overdue-reminder',
      expect.objectContaining({ recipientName: 'Ada Lovelace' }),
      undefined,
      expect.any(String),
    );
    expect(mockNotificationRepo.save).toHaveBeenCalled();
  });

  it('continues past one tenant failing so the rest still get processed', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);
    mockCheckoutRepo.find
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([]);

    await expect(scheduler.dispatchOverdueReminders()).resolves.toBeUndefined();
    expect(mockCheckoutRepo.find).toHaveBeenCalled();
    expect(mockCacheService.releaseLock).toHaveBeenCalled();
  });
});
