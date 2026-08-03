import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BranchRollupScheduler } from './branch-rollup.scheduler';
import { BranchRollupService } from '../service/branch-rollup.service';
import { CacheService } from '../../utility/service/cache.service';
import { Tenant } from '../../tenant/entity/tenant.entity';

const mockBranchRollupService = { computeAndUpsertOne: jest.fn() };
const mockCacheService = { acquireLock: jest.fn() };
const mockTenantRepo = { find: jest.fn() };

describe('BranchRollupScheduler', () => {
  let scheduler: BranchRollupScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.acquireLock.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BranchRollupScheduler,
        { provide: BranchRollupService, useValue: mockBranchRollupService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
      ],
    }).compile();
    scheduler = module.get(BranchRollupScheduler);
  });

  it('skips the run entirely when another instance holds the lock', async () => {
    mockCacheService.acquireLock.mockResolvedValue(false);
    await scheduler.computeAllRollups();
    expect(mockTenantRepo.find).not.toHaveBeenCalled();
  });

  it('computes a rollup for every active tenant', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 'tenant-1', subdomain: 'church-a' },
      { id: 'tenant-2', subdomain: 'church-b' },
    ]);
    mockBranchRollupService.computeAndUpsertOne.mockResolvedValue(undefined);

    await scheduler.computeAllRollups();

    expect(mockBranchRollupService.computeAndUpsertOne).toHaveBeenCalledTimes(
      2,
    );
  });

  it("continues past one tenant's failure so the rest still get computed", async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 'tenant-1', subdomain: 'church-a' },
      { id: 'tenant-2', subdomain: 'church-b' },
    ]);
    mockBranchRollupService.computeAndUpsertOne
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await expect(scheduler.computeAllRollups()).resolves.toBeUndefined();
    expect(mockBranchRollupService.computeAndUpsertOne).toHaveBeenCalledTimes(
      2,
    );
  });
});
