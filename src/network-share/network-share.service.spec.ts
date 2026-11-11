import { BadRequestException } from '@nestjs/common';
import { NetworkShareService, networkRootKey } from './network-share.service';

function setup(root: string | null, hasBranches = true) {
  const tenantRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 't1', networkRootId: root }),
    exists: jest.fn().mockResolvedValue(hasBranches),
  };
  const queue = { add: jest.fn() };
  const cache = {
    getGlobal: jest.fn().mockResolvedValue(undefined),
    setGlobal: jest.fn(),
    delGlobal: jest.fn(),
  };
  const cls = { get: jest.fn().mockReturnValue('t1') };
  return {
    service: new NetworkShareService(
      tenantRepo as never,
      queue as never,
      cache as never,
      cls as never,
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
});
