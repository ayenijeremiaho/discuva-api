import { NetworkEventsScheduler } from './network-events.scheduler';
import { NetworkMonthlyReportScheduler } from './network-monthly-report.scheduler';
import { NetworkCopyProcessor } from '../processor/network-copy.processor';

describe('network background work while Church networks is at 0', () => {
  const off = {
    networksOff: jest.fn().mockResolvedValue(true),
    isNetworkOnFor: jest.fn().mockResolvedValue(false),
  };
  const cache = { acquireLock: jest.fn(), releaseLock: jest.fn() };
  const tenantRepo = { find: jest.fn() };
  const dataSource = { query: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  it('the nightly job stops before touching the database or the queue', async () => {
    const share = { queueEventsCopy: jest.fn(), queueRollupNow: jest.fn() };
    const closures = { queueOverdue: jest.fn() };
    const job = new NetworkEventsScheduler(
      tenantRepo as never,
      cache as never,
      share as never,
      closures as never,
      off as never,
    );
    await job.refreshAll();
    expect(cache.acquireLock).not.toHaveBeenCalled();
    expect(tenantRepo.find).not.toHaveBeenCalled();
    expect(closures.queueOverdue).not.toHaveBeenCalled();
  });

  it('the monthly email stops before touching the database', async () => {
    const job = new NetworkMonthlyReportScheduler(
      tenantRepo as never,
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      cache as never,
      {} as never,
      {} as never,
      off as never,
    );
    await job.sendAll();
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('drops copies, recounts and closings queued before the switch went to 0', async () => {
    const copies = { copyEvents: jest.fn(), copyAnnouncement: jest.fn() };
    const rollups = { compute: jest.fn() };
    const closures = { run: jest.fn() };
    const processor = new NetworkCopyProcessor(
      copies as never,
      rollups as never,
      closures as never,
      off as never,
    );
    for (const kind of ['events', 'rollup', 'closure'] as const) {
      await processor.handle({
        data: { kind, sourceTenantId: 't1', sourceId: 'x' },
      } as never);
    }
    expect(copies.copyEvents).not.toHaveBeenCalled();
    expect(rollups.compute).not.toHaveBeenCalled();
    expect(closures.run).not.toHaveBeenCalled();
  });
});
