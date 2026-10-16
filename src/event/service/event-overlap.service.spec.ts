import { BadRequestException } from '@nestjs/common';
import { EventOverlapService } from './event-overlap.service';
import { EventOverlapRule } from '../enums/event-overlap-rule.enum';

describe('EventOverlapService', () => {
  const settingRepo = {
    findOne: jest.fn(),
    create: jest.fn((v) => v),
    save: jest.fn((v) => Promise.resolve(v)),
  };
  const tx = { query: jest.fn() };
  const mockCacheService = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(1),
    key: jest.fn().mockReturnValue('cache-key'),
  };
  const audit = { log: jest.fn() };
  const dateService = { format: jest.fn((_d: Date, p: string) => p) };
  const timezone = { get: jest.fn().mockResolvedValue('Africa/Lagos') };
  const service = new EventOverlapService(
    settingRepo as never,
    { tx } as never,
    mockCacheService as never,
    audit as never,
    dateService as never,
    timezone as never,
  );
  const slot = (name: string, forEveryone = true) => ({
    name,
    startTime: new Date('2026-11-01T09:00:00Z'),
    endTime: new Date('2026-11-01T11:00:00Z'),
    venueId: 'v1',
    forEveryone,
  });
  const other = (over: Record<string, unknown> = {}) => ({
    eventName: 'Sunday Service',
    slotName: 'First Service',
    startTime: new Date(),
    endTime: new Date(),
    venueName: null,
    theirsForEveryone: false,
    ...over,
  });

  beforeEach(() => jest.clearAllMocks());

  it('blocks every overlap until the church chooses', async () => {
    settingRepo.findOne.mockResolvedValue(null);
    await expect(service.getConfig()).resolves.toEqual({
      rule: EventOverlapRule.BLOCK_ALL,
      isDefault: true,
    });
  });

  it('saves the chosen rule, clears the cache and audits it', async () => {
    settingRepo.findOne.mockResolvedValue(null);
    await expect(
      service.setRule(EventOverlapRule.GROUPS_AT_OTHER_VENUES, 'm1'),
    ).resolves.toEqual({
      rule: EventOverlapRule.GROUPS_AT_OTHER_VENUES,
      isDefault: false,
    });
    expect(settingRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'events:overlap_rule',
        value: { rule: EventOverlapRule.GROUPS_AT_OTHER_VENUES },
      }),
    );
    expect(mockCacheService.del).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith('EVENT_OVERLAP_RULE_UPDATED', {
      actorId: 'm1',
      metadata: { rule: EventOverlapRule.GROUPS_AT_OTHER_VENUES },
    });
  });

  it('serves the rule from the cache once read', async () => {
    mockCacheService.get.mockResolvedValueOnce(EventOverlapRule.ALLOW);
    await expect(service.getRule()).resolves.toBe(EventOverlapRule.ALLOW);
    expect(settingRepo.findOne).not.toHaveBeenCalled();
  });

  it('makes saves take turns per church, unless overlaps are allowed', async () => {
    mockCacheService.get.mockResolvedValueOnce(EventOverlapRule.BLOCK_ALL);
    await service.lockSchedule();
    expect(tx.query).toHaveBeenCalledWith(
      expect.stringContaining(
        'pg_advisory_xact_lock(hashtext(current_schema()',
      ),
    );

    tx.query.mockClear();
    mockCacheService.get.mockResolvedValueOnce(EventOverlapRule.ALLOW);
    await service.lockSchedule();
    expect(tx.query).not.toHaveBeenCalled();
  });

  it("doesn't query when overlaps are allowed", async () => {
    await service.assertNoClash([slot('A')], EventOverlapRule.ALLOW);
    expect(tx.query).not.toHaveBeenCalled();
  });

  it('checks every service in one query, bounded by their overall window', async () => {
    tx.query.mockResolvedValue([]);
    const late = {
      ...slot('B'),
      startTime: new Date('2026-11-08T09:00:00Z'),
      endTime: new Date('2026-11-08T11:00:00Z'),
    };
    await service.assertNoClash([slot('A'), late], EventOverlapRule.BLOCK_ALL, {
      eventId: 'e1',
      seriesId: 's1',
    });
    expect(tx.query).toHaveBeenCalledTimes(1);
    const params = tx.query.mock.calls[0][1];
    expect(params.slice(4)).toEqual([
      'e1',
      's1',
      EventOverlapRule.BLOCK_ALL,
      new Date('2026-11-01T09:00:00Z'),
      new Date('2026-11-08T11:00:00Z'),
    ]);
  });

  it('returns the first clash for each service that has one', async () => {
    tx.query.mockResolvedValue([
      { i: 2, ...other(), startTime: '2026-11-01T09:00:00Z' },
    ]);
    const clashes = await service.findClashes(
      [slot('A'), slot('B')],
      EventOverlapRule.BLOCK_ALL,
    );
    expect(clashes).toEqual([
      expect.objectContaining({
        slot: expect.objectContaining({ name: 'B' }),
        eventName: 'Sunday Service',
        startTime: new Date('2026-11-01T09:00:00Z'),
      }),
    ]);
  });

  it('refuses a clash, with both times and why', async () => {
    tx.query.mockResolvedValue([
      { i: 1, ...other({ theirsForEveryone: true }) },
    ]);
    const err = await service
      .assertNoClash(
        [slot('Choir', false)],
        EventOverlapRule.GROUPS_AT_OTHER_VENUES,
      )
      .catch((e: BadRequestException) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toEqual({
      code: 'EVENT_OVERLAP',
      message:
        '"Choir" on EEE d MMM (h:mm a–h:mm a) overlaps "Sunday Service" (First Service, h:mm a–h:mm a). Sunday Service is for everyone. Pick another time, or change Overlapping Events in Event Configs.',
    });
  });

  it('gives the clash in parts so a screen can highlight it', async () => {
    await expect(
      service.overlapDetail(
        EventOverlapRule.GROUPS_AT_OTHER_VENUES,
        slot('Choir', false),
        other({ venueName: 'Youth Hall' }),
      ),
    ).resolves.toEqual({
      service: { name: 'Choir', time: 'h:mm a–h:mm a' },
      other: {
        eventName: 'Sunday Service',
        serviceName: 'First Service',
        time: 'h:mm a–h:mm a',
      },
      why: 'Both are at Youth Hall',
    });
  });

  describe('overlapPhrase', () => {
    const groups = EventOverlapRule.GROUPS_AT_OTHER_VENUES;

    it('names the shared venue when that is the reason', async () => {
      await expect(
        service.overlapPhrase(
          groups,
          'its Choir',
          slot('Choir', false),
          other({
            eventName: 'Youth Night',
            slotName: 'Worship',
            venueName: 'Youth Hall',
          }),
        ),
      ).resolves.toBe(
        'its Choir (h:mm a–h:mm a) overlaps "Youth Night" (Worship, h:mm a–h:mm a). Both are at Youth Hall',
      );
    });

    it('says when this service being for everyone is the reason', async () => {
      await expect(
        service.overlapPhrase(groups, 'its Rally', slot('Rally'), other()),
      ).resolves.toBe(
        'its Rally (h:mm a–h:mm a) overlaps "Sunday Service" (First Service, h:mm a–h:mm a). Rally is for everyone, so nothing else can run then',
      );
    });

    it('needs no reason beyond the times when every overlap is blocked', async () => {
      await expect(
        service.overlapPhrase(
          EventOverlapRule.BLOCK_ALL,
          'its Choir',
          slot('Choir', false),
          other({ venueName: 'Youth Hall' }),
        ),
      ).resolves.toBe(
        'its Choir (h:mm a–h:mm a) overlaps "Sunday Service" (First Service, h:mm a–h:mm a)',
      );
    });
  });
});
