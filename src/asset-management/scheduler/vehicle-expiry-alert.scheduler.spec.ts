import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { VehicleExpiryAlertScheduler } from './vehicle-expiry-alert.scheduler';
import { Asset } from '../entity/asset.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { CacheService } from '../../utility/service/cache.service';

const makeAdminQb = (admins: object[]) => ({
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue(admins),
});

const mockAssetRepo = {
  find: jest.fn().mockResolvedValue([]),
  save: jest.fn(),
};
const mockAdminRepo = { createQueryBuilder: jest.fn() };
const mockTenantRepo = { find: jest.fn() };
const mockUtilityService = { sendEmailWithTemplate: jest.fn() };
const mockCacheService = {
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn(),
};
const mockConfigService = {
  get: jest.fn().mockReturnValue('https://admin.example.com'),
};
const mockCls = {
  runWith: jest.fn((_store: unknown, fn: () => unknown) => fn()),
};
const mockTxHost = {
  tx: { query: jest.fn() },
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};

const admin = {
  member: { email: 'admin@example.com' },
  adminRole: { permissions: [AdminPermission.ASSET_MAINTENANCE_ALERT] },
};

describe('VehicleExpiryAlertScheduler', () => {
  let scheduler: VehicleExpiryAlertScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAssetRepo.find.mockResolvedValue([]);
    mockAdminRepo.createQueryBuilder.mockReturnValue(makeAdminQb([admin]));
    mockCacheService.acquireLock.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VehicleExpiryAlertScheduler,
        { provide: getRepositoryToken(Asset), useValue: mockAssetRepo },
        { provide: getRepositoryToken(Admin), useValue: mockAdminRepo },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
      ],
    }).compile();
    scheduler = module.get(VehicleExpiryAlertScheduler);
  });

  it('runs the asset query once per active tenant, entering each tenant context', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);

    await scheduler.dispatchVehicleExpiryAlerts();

    expect(mockAssetRepo.find).toHaveBeenCalledTimes(2);
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_a", public',
    );
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_b", public',
    );
  });

  it('sends an insurance alert and stamps the notified date at 14 days', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 14);
    const asset = {
      id: 'asset-1',
      name: 'Church Bus',
      insuranceExpiry: expiry.toISOString(),
      roadworthinessExpiry: null,
      insuranceNotified14DaysAt: null,
    };
    mockAssetRepo.find.mockResolvedValue([asset]);

    await scheduler.dispatchVehicleExpiryAlerts();

    expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
      'admin@example.com',
      expect.stringContaining('Insurance'),
      'asset-vehicle-expiry-alert',
      expect.any(Object),
      undefined,
      expect.any(String),
    );
    expect(mockAssetRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ insuranceNotified14DaysAt: expect.any(Date) }),
    );
  });

  it('continues past one tenant failing so the rest still get processed', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);
    mockAssetRepo.find
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([]);

    await expect(
      scheduler.dispatchVehicleExpiryAlerts(),
    ).resolves.toBeUndefined();
    expect(mockAssetRepo.find).toHaveBeenCalled();
    expect(mockCacheService.releaseLock).toHaveBeenCalled();
  });
});
