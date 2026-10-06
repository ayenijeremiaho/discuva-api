import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { ConfigService } from '@nestjs/config';
import { TransactionHost } from '@nestjs-cls/transactional';
import { EventSeriesScheduler } from './event-series.scheduler';
import { EventSeries } from '../entity/event-series.entity';
import { EventSeriesService } from '../service/event-series.service';
import { CacheService } from '../../utility/service/cache.service';
import { Tenant } from '../../tenant/entity/tenant.entity';

const mockQb = {
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
};
const mockSeriesRepo = { createQueryBuilder: jest.fn(() => mockQb) };
const mockTenantRepo = { find: jest.fn() };
const mockSeriesService = { generate: jest.fn().mockResolvedValue([]) };
const mockCache = { acquireLock: jest.fn(), releaseLock: jest.fn() };
const mockCls = { runWith: jest.fn((_s: unknown, fn: () => unknown) => fn()) };
const mockTxHost = {
  tx: { query: jest.fn() },
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};

describe('EventSeriesScheduler', () => {
  let scheduler: EventSeriesScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCache.acquireLock.mockResolvedValue(true);
    mockTenantRepo.find.mockResolvedValue([
      {
        id: 't1',
        subdomain: 'a',
        schemaName: 'church_a',
        timezone: 'Europe/London',
      },
      { id: 't2', subdomain: 'b', schemaName: 'church_b', timezone: null },
    ]);
    mockQb.getMany.mockResolvedValue([{ id: 's1' }]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventSeriesScheduler,
        { provide: getRepositoryToken(EventSeries), useValue: mockSeriesRepo },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: EventSeriesService, useValue: mockSeriesService },
        { provide: CacheService, useValue: mockCache },
        { provide: ConfigService, useValue: { get: () => 'Africa/Lagos' } },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
      ],
    }).compile();
    scheduler = module.get(EventSeriesScheduler);
  });

  it("tops up each church's active series in that church's timezone", async () => {
    await scheduler.topUp();

    expect(mockSeriesService.generate).toHaveBeenCalledWith(
      { id: 's1' },
      'Europe/London',
    );
    expect(mockSeriesService.generate).toHaveBeenCalledWith(
      { id: 's1' },
      'Africa/Lagos',
    );
    expect(mockCache.releaseLock).toHaveBeenCalled();
  });

  it('only loads active series that can still gain a date before the horizon', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-05T01:00:00Z'));
    try {
      await scheduler.topUp();
    } finally {
      jest.useRealTimers();
    }

    expect(mockQb.where).toHaveBeenCalledWith('s.is_active');
    expect(mockQb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('s.end_date > s.generated_through'),
      { horizon: '2026-11-30' },
    );
  });

  it('does nothing when another instance holds the lock', async () => {
    mockCache.acquireLock.mockResolvedValue(false);

    await scheduler.topUp();

    expect(mockSeriesService.generate).not.toHaveBeenCalled();
  });

  it('keeps going when one series fails', async () => {
    mockQb.getMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
    mockSeriesService.generate.mockRejectedValueOnce(new Error('boom'));

    await scheduler.topUp();

    expect(mockSeriesService.generate).toHaveBeenCalledTimes(4);
  });
});
