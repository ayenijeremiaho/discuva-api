import { NetworkVenueService } from './network-venue.service';

function setup(rootId: string | null) {
  const copyRepo = {
    delete: jest.fn(),
    insert: jest.fn(),
    find: jest.fn().mockResolvedValue([{ tenantId: 'lekki', venueId: 'v1' }]),
  };
  const tenantRepo = {
    findOne: jest
      .fn()
      .mockResolvedValue({ id: 'lekki', networkRootId: rootId }),
  };
  const venueRepo = {
    find: jest
      .fn()
      .mockResolvedValue([
        { id: 'v1', name: 'Hall', latitude: 6.4, longitude: 3.4 },
      ]),
  };
  const cache = {
    getGlobal: jest.fn().mockResolvedValue(undefined),
    setGlobal: jest.fn(),
    delGlobal: jest.fn(),
  };
  const cls = { get: jest.fn().mockReturnValue('lekki') };
  const service = new NetworkVenueService(
    copyRepo as never,
    tenantRepo as never,
    venueRepo as never,
    cache as never,
    cls as never,
  );
  return { service, copyRepo, cache, venueRepo };
}

describe('NetworkVenueService', () => {
  it("copies a networked church's venues whole and clears the network's cached list", async () => {
    const t = setup('root');
    await t.service.syncCurrent();
    expect(t.copyRepo.delete).toHaveBeenCalledWith({ tenantId: 'lekki' });
    expect(t.copyRepo.insert).toHaveBeenCalledWith([
      {
        tenantId: 'lekki',
        venueId: 'v1',
        networkRootId: 'root',
        name: 'Hall',
        latitude: 6.4,
        longitude: 3.4,
      },
    ]);
    expect(t.cache.delGlobal).toHaveBeenCalledWith('network-venues:root');
  });

  it('does nothing for a church outside a network', async () => {
    const t = setup(null);
    await t.service.syncCurrent();
    expect(t.venueRepo.find).not.toHaveBeenCalled();
    expect(t.copyRepo.delete).not.toHaveBeenCalled();
  });

  it("serves a network's venues from cache after the first read", async () => {
    const t = setup('root');
    await t.service.forNetwork('root');
    expect(t.cache.setGlobal).toHaveBeenCalledWith(
      'network-venues:root',
      [{ tenantId: 'lekki', venueId: 'v1' }],
      3600,
    );
    t.cache.getGlobal.mockResolvedValue([{ tenantId: 'cached' }]);
    expect(await t.service.forNetwork('root')).toEqual([
      { tenantId: 'cached' },
    ]);
    expect(t.copyRepo.find).toHaveBeenCalledTimes(1);
  });
});
