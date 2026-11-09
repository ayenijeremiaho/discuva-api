import { TenantDeletionService } from '../service/tenant-deletion.service';
import { getQueueToken } from '@nestjs/bull';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { AccountLifecycleScheduler } from './account-lifecycle.scheduler';
import { Tenant } from '../entity/tenant.entity';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';
import { CacheService } from '../../utility/service/cache.service';
import { UtilityService } from '../../utility/service/utility.service';
import { ACCOUNT_FILE_CLEANUP_QUEUE } from '../processor/account-file-cleanup.processor';

const clauses: string[] = [];
let results: Partial<Tenant>[][];
const makeBuilder = () => {
  const builder = {
    where: jest.fn((c: string) => {
      clauses.push(c);
      return builder;
    }),
    andWhere: jest.fn((c: string) => {
      clauses.push(c);
      return builder;
    }),
    take: jest.fn(() => builder),
    getMany: jest.fn(async () => results.shift() ?? []),
  };
  return builder;
};
const mockRepo = {
  createQueryBuilder: jest.fn(makeBuilder),
  update: jest.fn(),
};
const managerQuery = jest.fn();
const managerDelete = jest.fn();
const mockDataSource = {
  transaction: jest.fn(async (work: (m: unknown) => Promise<void>) =>
    work({ query: managerQuery, delete: managerDelete }),
  ),
};
let settings: Record<string, number>;
const mockSettings = {
  getNumber: jest.fn(async (key: string) => settings[key]),
};
const mockCache = {
  acquireLock: jest.fn().mockResolvedValue(true),
  flushTenant: jest.fn().mockResolvedValue(undefined),
};
const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
const mockUtility = { sendEmailWithTemplate: jest.fn() };

const tenant = (over: object = {}) => ({
  id: 't1',
  name: 'Friday Prayer',
  subdomain: 'friday',
  schemaName: 'tenant_friday',
  requestDetails: { adminEmail: 'a@example.com' },
  ...over,
});

describe('AccountLifecycleScheduler', () => {
  let scheduler: AccountLifecycleScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    clauses.length = 0;
    results = [[], [], []];
    managerQuery.mockReset();
    managerQuery.mockResolvedValue([]);
    settings = {
      [PlatformSettingKey.ACCOUNT_ARCHIVE_AFTER_DAYS]: 90,
      [PlatformSettingKey.ACCOUNT_DELETE_AFTER_DAYS]: 100,
      [PlatformSettingKey.ACCOUNT_AUTO_DELETE]: 1,
    };
    mockCache.acquireLock.mockResolvedValue(true);
    const module = await Test.createTestingModule({
      providers: [
        AccountLifecycleScheduler,
        TenantDeletionService,
        { provide: getRepositoryToken(Tenant), useValue: mockRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: PlatformSettingsService, useValue: mockSettings },
        { provide: CacheService, useValue: mockCache },
        { provide: UtilityService, useValue: mockUtility },
        {
          provide: getQueueToken(ACCOUNT_FILE_CLEANUP_QUEUE),
          useValue: mockQueue,
        },
      ],
    }).compile();
    scheduler = module.get(AccountLifecycleScheduler);
  });

  it('only ever considers unverified, free, standalone, active accounts', async () => {
    await scheduler.run();
    const all = clauses.join(' ');
    expect(all).toContain('t.verifiedAt IS NULL');
    expect(all).toContain("t.onboardingStatus = 'ACTIVE'");
    expect(all).toContain('t.parentTenantId IS NULL');
    expect(all).toContain('child.parent_tenant_id = t.id');
    expect(all).toContain("s.plan_id NOT IN ('free', 'group-free')");
  });

  it('warns once, a week before archiving', async () => {
    results = [[tenant()], [], []];
    const now = new Date();
    await scheduler.run(now);
    expect(mockRepo.update).toHaveBeenCalledWith('t1', {
      inactivityWarnedAt: now,
    });
    expect(mockUtility.sendEmailWithTemplate).toHaveBeenCalledTimes(1);
  });

  it('archives and tells the account when deletion will happen', async () => {
    results = [[], [tenant()], []];
    const now = new Date();
    await scheduler.run(now);
    expect(mockRepo.update).toHaveBeenCalledWith('t1', { archivedAt: now });
    expect(
      mockUtility.sendEmailWithTemplate.mock.calls[0][3].message,
    ).toContain('permanently deleted in 10 days');
  });

  it('deletes the schema and the account row together', async () => {
    results = [[], [], [tenant({ archivedAt: new Date(0) })]];
    await scheduler.run();
    expect(managerQuery).toHaveBeenCalledWith(
      'DROP SCHEMA IF EXISTS "tenant_friday" CASCADE',
    );
    expect(managerDelete).toHaveBeenCalledWith(Tenant, { id: 't1' });
    expect(clauses.join(' ')).toContain('t.archivedAt IS NOT NULL');
  });

  it('also removes records outside the schema, and reads file ids before the drop', async () => {
    managerQuery.mockResolvedValueOnce([{ id: 'tithes/1' }]);
    results = [[], [], [tenant()]];
    await scheduler.run(new Date());
    const sql = managerQuery.mock.calls.map((c) => c[0] as string);
    const drop = sql.findIndex((q) => q.includes('DROP SCHEMA'));
    expect(
      sql.findIndex((q) => q.includes('tenant_friday".members')),
    ).toBeLessThan(drop);
    expect(sql.some((q) => q.includes('feature_usages'))).toBe(true);
    expect(managerQuery).toHaveBeenCalledWith(
      expect.stringContaining('public.email_logs'),
      [['a@example.com'], 'Friday Prayer'],
    );
    expect(mockQueue.add).toHaveBeenCalledWith(
      { tenantId: 't1', legacyPublicIds: ['tithes/1'] },
      expect.objectContaining({ attempts: 8 }),
    );
    expect(mockCache.flushTenant).toHaveBeenCalledWith('t1');
  });

  it('queues no file cleanup when the database delete fails', async () => {
    managerQuery.mockRejectedValue(new Error('locked'));
    results = [[], [], [tenant()]];
    await scheduler.run(new Date());
    expect(mockQueue.add).not.toHaveBeenCalled();
    expect(mockCache.flushTenant).not.toHaveBeenCalled();
  });

  it('keeps the delete when queueing the file cleanup fails', async () => {
    mockQueue.add.mockRejectedValueOnce(new Error('redis down'));
    results = [[], [], [tenant()]];
    await scheduler.run(new Date());
    expect(managerDelete).toHaveBeenCalled();
    expect(mockUtility.sendEmailWithTemplate).toHaveBeenCalled();
  });

  it('never deletes while the setting is off', async () => {
    settings[PlatformSettingKey.ACCOUNT_AUTO_DELETE] = 0;
    results = [[], [], [tenant({ archivedAt: new Date(0) })]];
    await scheduler.run();
    expect(mockDataSource.transaction).not.toHaveBeenCalled();
  });

  it('refuses an unsafe schema name', async () => {
    results = [[], [], [tenant({ schemaName: 'x"; DROP' })]];
    await scheduler.run();
    expect(managerQuery).not.toHaveBeenCalled();
  });

  it('carries on after one account fails, and says nothing was deleted', async () => {
    managerQuery.mockRejectedValueOnce(new Error('locked'));
    results = [[], [], [tenant(), tenant({ id: 't2' })]];
    await scheduler.run();
    expect(managerDelete).toHaveBeenCalledTimes(1);
    expect(mockUtility.sendEmailWithTemplate).toHaveBeenCalledTimes(1);
  });

  it('keeps deletion after archiving even if the settings are reversed', async () => {
    settings[PlatformSettingKey.ACCOUNT_DELETE_AFTER_DAYS] = 30;
    results = [[], [tenant()], []];
    await scheduler.run();
    expect(
      mockUtility.sendEmailWithTemplate.mock.calls[0][3].message,
    ).toContain('permanently deleted in 1 days');
  });

  it('runs once across servers', async () => {
    mockCache.acquireLock.mockResolvedValue(false);
    await scheduler.run();
    expect(mockRepo.createQueryBuilder).not.toHaveBeenCalled();
  });
});
