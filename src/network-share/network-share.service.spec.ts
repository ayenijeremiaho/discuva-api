import { BadRequestException } from '@nestjs/common';
import { NetworkShareService, networkRootKey } from './network-share.service';

function setup(root: string | null, hasBranches = true, networksOn = true) {
  const accounts = { readModeOn: jest.fn().mockResolvedValue(networksOn) };
  const tenantRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 't1', networkRootId: root }),
    exists: jest.fn().mockResolvedValue(hasBranches),
  };
  const queue = { add: jest.fn() };
  const cache = {
    getGlobal: jest.fn().mockResolvedValue(undefined),
    setGlobal: jest.fn(),
    delGlobal: jest.fn(),
    acquireLock: jest.fn().mockResolvedValue(true),
  };
  const platformSettings = { getNumber: jest.fn().mockResolvedValue(10) };
  const cls = { get: jest.fn().mockReturnValue('t1') };
  return {
    service: new NetworkShareService(
      tenantRepo as never,
      queue as never,
      cache as never,
      cls as never,
      platformSettings as never,
      accounts as never,
    ),
    queue,
    cache,
    tenantRepo,
  };
}

describe('NetworkShareService', () => {
  it('books one delayed events copy per church, keyed so a burst of edits shares it', async () => {
    const t = setup('root');
    await t.service.eventsChanged();
    expect(t.queue.add).toHaveBeenCalledWith(
      { kind: 'events', sourceTenantId: 't1' },
      expect.objectContaining({ jobId: 'events:t1', delay: 60_000 }),
    );
    expect(t.cache.setGlobal).toHaveBeenCalledWith(
      networkRootKey('t1'),
      { root: 'root' },
      600,
    );
  });

  it('does nothing for a church outside a network, and remembers that', async () => {
    const t = setup(null);
    await t.service.eventsChanged();
    expect(t.queue.add).not.toHaveBeenCalled();
    t.cache.getGlobal.mockResolvedValue({ root: null });
    await t.service.eventsChanged();
    expect(t.tenantRepo.findOne).toHaveBeenCalledTimes(1);
  });

  it('forgets the cached answer when a church starts a network', async () => {
    const t = setup('t1');
    await t.service.joinedNetwork('t1');
    expect(t.cache.delGlobal).toHaveBeenCalledWith(networkRootKey('t1'));
    expect(t.queue.add).toHaveBeenCalled();
  });

  it('only lets a church with branches send to branches', async () => {
    await expect(
      setup('root', false).service.assertCanShare(),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      setup('root', true).service.assertCanShare(),
    ).resolves.toBeUndefined();
  });

  it("doesn't send to branches while church networks are switched off", async () => {
    await expect(
      setup('root', true, false).service.assertCanShare(),
    ).rejects.toThrow('Church networks are not available yet.');
  });

  it('books one report recalculation after the wait, and later changes in that wait cost one Redis check', async () => {
    const t = setup('root');
    await t.service.rollupChanged();
    expect(t.cache.acquireLock).toHaveBeenCalledWith('rollup-mark:t1', 600);
    expect(t.queue.add).toHaveBeenCalledWith(
      { kind: 'rollup', sourceTenantId: 't1' },
      expect.objectContaining({ jobId: 'rollup:t1', delay: 600_000 }),
    );
    t.queue.add.mockClear();
    t.cache.acquireLock.mockResolvedValue(false);
    await t.service.rollupChanged();
    expect(t.queue.add).not.toHaveBeenCalled();
  });

  it('never marks a church outside a network', async () => {
    const t = setup(null);
    await t.service.rollupChanged();
    expect(t.cache.acquireLock).not.toHaveBeenCalled();
  });
});
