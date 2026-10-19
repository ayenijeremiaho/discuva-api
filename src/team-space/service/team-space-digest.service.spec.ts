import {
  TeamSpaceDigestService,
  digestSummary,
} from './team-space-digest.service';

describe('TeamSpaceDigestService', () => {
  // Lagos is UTC+1, so 18:00 there is 17:00 UTC.
  const tonight = new Date('2026-10-19T17:00:00Z');
  const tomorrow = new Date('2026-10-20T17:00:00Z');
  const spaceRepo = { find: jest.fn(), query: jest.fn() };
  const cache = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(1),
    key: jest.fn().mockReturnValue('cache-key'),
  };
  const access = { memberIds: jest.fn() };
  const notifications = {
    notifyMember: jest.fn().mockResolvedValue(undefined),
  };
  const service = new TeamSpaceDigestService(
    spaceRepo as never,
    access as never,
    { get: jest.fn().mockResolvedValue('Africa/Lagos') } as never,
    cache as never,
    notifications as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    spaceRepo.find.mockResolvedValue([]);
  });

  it('sleeps until this evening without touching the database', async () => {
    expect(await service.run(new Date('2026-10-19T09:00:00Z'))).toEqual(
      tonight,
    );
    expect(spaceRepo.find).not.toHaveBeenCalled();
  });

  it('counts a tick that fires a moment before the hour as on time', async () => {
    expect(await service.run(new Date('2026-10-19T16:59:30Z'))).toEqual(
      tomorrow,
    );
    expect(spaceRepo.find).toHaveBeenCalled();
  });

  it('sends once a day: a second run that evening only checks the cache', async () => {
    cache.get.mockResolvedValueOnce(true);
    expect(await service.run(new Date('2026-10-19T18:00:00Z'))).toEqual(
      tomorrow,
    );
    expect(spaceRepo.find).not.toHaveBeenCalled();
  });

  it('stops after one query when no space was active today', async () => {
    expect(await service.run(new Date('2026-10-19T17:00:05Z'))).toEqual(
      tomorrow,
    );
    expect(spaceRepo.find).toHaveBeenCalledTimes(1);
    expect(spaceRepo.query).not.toHaveBeenCalled();
    expect(notifications.notifyMember).not.toHaveBeenCalled();
  });

  it('writes a short summary', () => {
    expect(
      digestSummary([
        { name: 'Choir', n: 2 },
        { name: 'Ushering', n: 5 },
      ]),
    ).toBe('7 new in Ushering and Choir');
  });
});
