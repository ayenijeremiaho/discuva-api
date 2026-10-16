import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { EventSeriesService } from './event-series.service';
import { EventSeries } from '../entity/event-series.entity';
import { Event } from '../entity/event.entity';
import { EventService } from './event.service';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { EventRecurrencePatternEnum } from '../enums/event-recurrence-patterns.enums';
import { EventOverlapService } from './event-overlap.service';
import { EventOverlapRule } from '../enums/event-overlap-rule.enum';

const TZ = 'Africa/Lagos';

const mockSeriesRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'series-1', ...v })),
  find: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
};
const mockEventRepo = {
  existsBy: jest.fn().mockResolvedValue(false),
  save: jest.fn((v) =>
    Promise.resolve({ id: `ev-${v.seriesOccurrenceDate}`, ...v }),
  ),
  find: jest.fn(),
  findOne: jest.fn(),
  count: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn(),
};
const mockEventService = {
  buildOccurrence: jest.fn((fields, slots) =>
    Promise.resolve({ ...fields, serviceSlots: slots }),
  ),
  prepareProgrammes: jest.fn().mockResolvedValue(undefined),
  hasRecordedHistory: jest.fn().mockResolvedValue(false),
  updateOccurrenceInPlace: jest.fn((e) => Promise.resolve(e)),
  toSlotDto: jest.fn((s) => s),
  resolveAudience: jest.fn((d: { audience?: string }) =>
    Promise.resolve({
      audience: d.audience ?? 'EVERYONE',
      audienceGroupId: null,
    }),
  ),
  toCandidates: jest.fn(
    (dtos: { name: string; startTime: string; endTime: string }[]) =>
      Promise.resolve(
        dtos.map((d) => ({
          name: d.name,
          startTime: new Date(d.startTime),
          endTime: new Date(d.endTime),
          venueId: null,
          forEveryone: true,
        })),
      ),
  ),
};
const mockOverlapService = {
  getRule: jest.fn(),
  findClashes: jest.fn(),
  day: jest.fn((d: Date) => Promise.resolve(d.toISOString().slice(0, 10))),
  overlapPhrase: jest.fn(
    (
      _rule,
      label: string,
      _mine,
      other: { eventName: string; slotName: string },
    ) =>
      Promise.resolve(
        `${label} overlaps "${other.eventName}" (${other.slotName})`,
      ),
  ),
  venueName: jest.fn().mockResolvedValue('Main Auditorium'),
  lockSchedule: jest.fn().mockResolvedValue(undefined),
  overlapDetail: jest.fn(
    (
      _rule,
      mine: { name: string },
      other: { eventName: string; slotName: string },
    ) =>
      Promise.resolve({
        service: { name: mine.name, time: '9–11' },
        other: {
          eventName: other.eventName,
          serviceName: other.slotName,
          time: '10–1',
        },
        why: null,
      }),
  ),
};
const mockTimezone = { get: jest.fn().mockResolvedValue(TZ) };
const mockAudit = { log: jest.fn() };

const sunday = (over: Partial<EventSeries> = {}): EventSeries =>
  ({
    id: 'series-1',
    name: 'Sunday Service',
    description: null,
    onlineAttendanceEnabled: false,
    recurrencePattern: EventRecurrencePatternEnum.WEEKLY,
    recurrenceInterval: 1,
    startDate: '2026-10-04',
    endDate: null,
    slotBlueprint: [
      {
        name: 'First Service',
        startTime: '08:00',
        durationMinutes: 120,
        dayOffset: 0,
      },
    ],
    autoProgramme: true,
    generatedThrough: null,
    isActive: true,
    ...over,
  }) as EventSeries;

describe('EventSeriesService', () => {
  let service: EventSeriesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockEventRepo.existsBy.mockResolvedValue(false);
    mockEventService.hasRecordedHistory.mockResolvedValue(false);
    mockOverlapService.getRule.mockResolvedValue(EventOverlapRule.ALLOW);
    mockOverlapService.findClashes.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventSeriesService,
        { provide: getRepositoryToken(EventSeries), useValue: mockSeriesRepo },
        { provide: getRepositoryToken(Event), useValue: mockEventRepo },
        { provide: EventService, useValue: mockEventService },
        { provide: ChurchTimezoneService, useValue: mockTimezone },
        { provide: AuditLogService, useValue: mockAudit },
        { provide: EventOverlapService, useValue: mockOverlapService },
      ],
    }).compile();
    service = module.get(EventSeriesService);
  });

  describe('occurrenceDates', () => {
    it('steps weekly, every N weeks and monthly, stopping at the end date', () => {
      expect(service.occurrenceDates(sunday(), '2026-10-25')).toEqual([
        '2026-10-04',
        '2026-10-11',
        '2026-10-18',
        '2026-10-25',
      ]);
      expect(
        service.occurrenceDates(
          sunday({ recurrenceInterval: 2 }),
          '2026-10-25',
        ),
      ).toEqual(['2026-10-04', '2026-10-18']);
      expect(
        service.occurrenceDates(
          sunday({ recurrencePattern: EventRecurrencePatternEnum.MONTHLY }),
          '2027-01-31',
        ),
      ).toEqual(['2026-10-04', '2026-11-04', '2026-12-04', '2027-01-04']);
      expect(
        service.occurrenceDates(
          sunday({ endDate: '2026-10-11' }),
          '2026-12-31',
        ),
      ).toEqual(['2026-10-04', '2026-10-11']);
    });
  });

  describe('generate', () => {
    const now = new Date('2026-10-03T12:00:00Z');

    it('creates 8 weeks ahead in the church timezone and records how far it got', async () => {
      const series = sunday();
      const { created } = await service.generate(series, TZ, now);

      expect(created).toHaveLength(8);
      expect(mockEventService.buildOccurrence).toHaveBeenCalledWith(
        expect.objectContaining({
          recurringEventId: 'series-1',
          seriesOccurrenceDate: '2026-10-04',
        }),
        [expect.objectContaining({ startTime: '2026-10-04T07:00:00.000Z' })],
      );
      expect(series.generatedThrough).toBe('2026-11-22');
      expect(mockEventService.prepareProgrammes).toHaveBeenCalledTimes(8);
    });

    it('fills in around what is already booked: clashing dates are skipped, in one query', async () => {
      mockOverlapService.getRule.mockResolvedValue(EventOverlapRule.BLOCK_ALL);
      mockOverlapService.findClashes.mockImplementation((slots) =>
        Promise.resolve([
          { slot: slots[2], eventName: 'Harvest', slotName: 'Thanksgiving' },
        ]),
      );
      const series = sunday();

      const { created, skipped } = await service.generate(series, TZ, now);

      expect(mockOverlapService.findClashes).toHaveBeenCalledTimes(1);
      const [slots, , exclude] = mockOverlapService.findClashes.mock.calls[0];
      expect(slots).toHaveLength(8);
      expect(exclude).toEqual({ seriesId: 'series-1' });
      expect(created).toHaveLength(7);
      expect(created.map((e) => e.seriesOccurrenceDate)).not.toContain(
        '2026-10-18',
      );
      expect(skipped).toEqual([
        {
          date: '2026-10-18',
          clashesWith: 'Harvest',
          reason:
            'its First Service (9–11) overlaps "Harvest" (Thanksgiving, 10–1)',
          note: 'Skipped 2026-10-18 — its First Service (9–11) overlaps "Harvest" (Thanksgiving, 10–1).',
          clash: {
            service: { name: 'First Service', time: '9–11' },
            other: {
              eventName: 'Harvest',
              serviceName: 'Thanksgiving',
              time: '10–1',
            },
            why: null,
          },
        },
      ]);
      // Skipped dates aren't revisited later, so the top-up won't add them back.
      expect(series.generatedThrough).toBe('2026-11-22');
    });

    it("doesn't query when overlaps are allowed", async () => {
      await service.generate(sunday(), TZ, now);
      expect(mockOverlapService.findClashes).not.toHaveBeenCalled();
    });

    it('never revisits dates already generated, so a cancelled service stays cancelled', async () => {
      const { created } = await service.generate(
        sunday({ generatedThrough: '2026-11-15' }),
        TZ,
        now,
      );

      expect(created.map((e) => e.seriesOccurrenceDate)).toEqual([
        '2026-11-22',
      ]);
    });

    it('skips a date whose service has already started, and one that already exists', async () => {
      mockEventRepo.existsBy.mockImplementation(({ seriesOccurrenceDate }) =>
        Promise.resolve(seriesOccurrenceDate === '2026-10-11'),
      );

      const { created } = await service.generate(
        sunday({ endDate: '2026-10-18' }),
        TZ,
        new Date('2026-10-04T07:30:00Z'),
      );

      expect(created.map((e) => e.seriesOccurrenceDate)).toEqual([
        '2026-10-18',
      ]);
    });

    it("doesn't prepare programmes when the series has that turned off", async () => {
      await service.generate(
        sunday({ autoProgramme: false, endDate: '2026-10-04' }),
        TZ,
        now,
      );

      expect(mockEventService.prepareProgrammes).not.toHaveBeenCalled();
    });
  });

  describe('createFromEvent', () => {
    const slots = [
      {
        name: 'First Service',
        startTime: '2026-10-04T07:00:00.000Z',
        endTime: '2026-10-04T09:00:00.000Z',
      },
    ];

    it('saves the rule as times of day and creates the first occurrences', async () => {
      jest
        .spyOn(service, 'generate')
        .mockResolvedValue({ created: [], skipped: [] });

      await service.createFromEvent(
        {
          name: 'Sunday Service',
          isRecurring: true,
          recurrence: {
            recurrencePattern: EventRecurrencePatternEnum.WEEKLY,
            recurrenceInterval: 1,
            ongoing: true,
          },
          serviceSlots: slots,
        },
        'member-1',
      );

      expect(mockSeriesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: '2026-10-04',
          endDate: null,
          slotBlueprint: [
            expect.objectContaining({
              startTime: '08:00',
              durationMinutes: 120,
              dayOffset: 0,
            }),
          ],
          autoProgramme: true,
        }),
      );
    });

    it('limits a fixed end date to a year', async () => {
      await expect(
        service.createFromEvent(
          {
            name: 'Long',
            isRecurring: true,
            recurrence: {
              recurrencePattern: EventRecurrencePatternEnum.WEEKLY,
              recurrenceInterval: 1,
              recurrenceEndDate: '2027-12-01',
            },
            serviceSlots: slots,
          },
          'member-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a series that clashes on every date, rather than creating an empty one', async () => {
      jest.spyOn(service, 'generate').mockResolvedValue({
        created: [],
        skipped: [
          {
            date: '2026-10-04',
            clashesWith: 'Youth Night',
            reason: '',
            note: '',
            clash: null as never,
          },
        ],
      });
      await expect(
        service.createFromEvent(
          {
            name: 'Sunday Service',
            isRecurring: true,
            recurrence: {
              recurrencePattern: EventRecurrencePatternEnum.WEEKLY,
              recurrenceInterval: 1,
              ongoing: true,
            },
            serviceSlots: slots,
          },
          'member-1',
        ),
      ).rejects.toThrow('Every date clashes with "Youth Night"');
    });
  });

  describe('preview', () => {
    it('lists each date as ready or skipped, saving nothing and never looking up an unsaved series', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-03T12:00:00Z'));
      try {
        mockOverlapService.getRule.mockResolvedValue(
          EventOverlapRule.BLOCK_ALL,
        );
        mockOverlapService.findClashes.mockImplementation((slots) =>
          Promise.resolve([
            { slot: slots[1], eventName: 'Harvest', slotName: 'Thanksgiving' },
          ]),
        );
        const result = await service.preview({
          name: 'Sunday Service',
          isRecurring: true,
          recurrence: {
            recurrencePattern: EventRecurrencePatternEnum.WEEKLY,
            recurrenceInterval: 1,
            recurrenceEndDate: '2026-10-25',
          },
          serviceSlots: [
            {
              name: 'First Service',
              startTime: '2026-10-04T07:00:00.000Z',
              endTime: '2026-10-04T09:00:00.000Z',
            },
          ],
        });
        expect(result.dates.map((d) => [d.date, d.status])).toEqual([
          ['2026-10-04', 'READY'],
          ['2026-10-11', 'SKIPPED'],
          ['2026-10-18', 'READY'],
          ['2026-10-25', 'READY'],
        ]);
        expect(result.dates[1].clashes).toEqual([
          {
            service: { name: 'First Service', time: '9–11' },
            other: {
              eventName: 'Harvest',
              serviceName: 'Thanksgiving',
              time: '10–1',
            },
            why: null,
          },
        ]);
        expect(result.canSave).toBe(true);
        expect(mockSeriesRepo.save).not.toHaveBeenCalled();
        expect(mockEventRepo.save).not.toHaveBeenCalled();
        expect(mockEventRepo.existsBy).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('previewUpdate', () => {
    const occ = (id: string, date: string, names = ['First Service']) => ({
      id,
      name: 'Sunday Service',
      seriesOccurrenceDate: date,
      serviceSlots: names.map((name) => ({
        name,
        startTime: new Date(`${date}T07:00:00Z`),
        endTime: new Date(`${date}T09:00:00Z`),
      })),
    });
    const blueprint = (names: string[]) =>
      names.map((name) => ({
        name,
        startTime: '18:00',
        durationMinutes: 60,
        dayOffset: 0,
      }));

    beforeEach(() => {
      mockSeriesRepo.findOne.mockResolvedValue(sunday());
      mockEventService.toSlotDto.mockImplementation((s) => ({
        name: s.name,
        startTime: s.startTime.toISOString(),
        endTime: s.endTime.toISOString(),
      }));
    });

    afterEach(() => mockEventService.toSlotDto.mockImplementation((s) => s));

    it('only covers dates it can change: not started, no check-ins or session', async () => {
      mockEventRepo.find.mockResolvedValue([
        occ('a', '2026-10-11'),
        occ('b', '2026-10-18'),
        occ('c', '2026-10-25'),
      ]);
      mockEventService.hasRecordedHistory.mockImplementation((id) =>
        Promise.resolve(id === 'b'),
      );
      mockOverlapService.getRule.mockResolvedValue(EventOverlapRule.BLOCK_ALL);
      mockOverlapService.findClashes.mockImplementation((slots) =>
        Promise.resolve([
          { slot: slots[2], eventName: 'Harvest', slotName: 'Thanksgiving' },
        ]),
      );

      const result = await service.previewUpdate('series-1', {
        effectiveFrom: '2026-10-11',
        slotBlueprint: blueprint(['First Service', 'Second Service']),
      });

      expect(mockEventRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ startTime: expect.anything() }),
        }),
      );
      expect(result.dates.map((d) => [d.date, d.status, d.recreated])).toEqual([
        ['2026-10-11', 'READY', true],
        ['2026-10-25', 'SKIPPED', false],
      ]);
      expect(result.keptWithHistory).toBe(1);
      // The clashing date keeps its current 07:00 start; the one that changes shows the new 18:00 one.
      expect(result.dates[1].startTime).toBe('2026-10-25T07:00:00.000Z');
      expect(result.dates[0].startTime).not.toBe('2026-10-11T07:00:00.000Z');
      expect(mockEventRepo.save).not.toHaveBeenCalled();
      expect(mockEventRepo.remove).not.toHaveBeenCalled();
      expect(mockSeriesRepo.save).not.toHaveBeenCalled();
    });

    it('previews a move as the new dates, keeping only those with check-ins', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-03T12:00:00Z'));
      try {
        mockSeriesRepo.findOne.mockResolvedValue(
          sunday({ endDate: '2026-10-31' }),
        );
        mockEventRepo.find.mockResolvedValue([
          occ('a', '2026-10-11'),
          occ('b', '2026-10-18'),
        ]);
        mockEventService.hasRecordedHistory.mockImplementation((id) =>
          Promise.resolve(id === 'b'),
        );
        const result = await service.previewUpdate('series-1', {
          effectiveFrom: '2026-10-11',
          moveTo: '2026-10-10',
        });
        expect(result.movedTo).toBe('2026-10-10');
        expect(result.dates.map((d) => d.date)).toEqual([
          '2026-10-10',
          '2026-10-17',
          '2026-10-24',
          '2026-10-31',
        ]);
        expect(result.keptWithHistory).toBe(1);
        expect(mockEventRepo.existsBy).not.toHaveBeenCalled();
        expect(mockEventRepo.remove).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('datesGivingWay', () => {
    // A one-off on Sun 6 Dec, 08:30–09:30, while the weekly 08:00–10:00 series is only created up to 22 Nov.
    const oneOff = {
      name: 'Carol Service',
      startTime: new Date('2026-12-06T07:30:00Z'),
      endTime: new Date('2026-12-06T08:30:00Z'),
      venueId: null,
      forEveryone: true,
    };

    it('names the series dates not created yet that will give way', async () => {
      mockSeriesRepo.find.mockResolvedValue([
        sunday({ generatedThrough: '2026-11-22' }),
      ]);
      await expect(
        service.datesGivingWay(
          [oneOff],
          EventOverlapRule.BLOCK_ALL,
          'Carol Service',
        ),
      ).resolves.toEqual([
        'Sunday Service won\'t be added on 2026-12-06 — its First Service (9–11) overlaps "Carol Service" (Carol Service, 10–1).',
      ]);
    });

    it('stays quiet for dates already created (those block instead), its own series, and when overlaps are allowed', async () => {
      mockSeriesRepo.find.mockResolvedValue([
        sunday({ generatedThrough: '2026-12-13' }),
      ]);
      await expect(
        service.datesGivingWay(
          [oneOff],
          EventOverlapRule.BLOCK_ALL,
          'Carol Service',
        ),
      ).resolves.toEqual([]);

      mockSeriesRepo.find.mockResolvedValue([sunday()]);
      await expect(
        service.datesGivingWay(
          [oneOff],
          EventOverlapRule.BLOCK_ALL,
          'Carol Service',
          'series-1',
        ),
      ).resolves.toEqual([]);
      await expect(
        service.datesGivingWay(
          [oneOff],
          EventOverlapRule.ALLOW,
          'Carol Service',
        ),
      ).resolves.toEqual([]);
    });
  });

  describe('update', () => {
    const occurrence = (id: string, names = ['First Service']) => ({
      id,
      name: 'Sunday Service',
      seriesOccurrenceDate: '2026-10-11',
      serviceSlots: names.map((name) => ({ name })),
    });

    beforeEach(() => {
      mockSeriesRepo.findOne.mockResolvedValue(sunday());
    });

    it('moves upcoming services in place and leaves ones with history alone', async () => {
      mockEventRepo.find.mockResolvedValue([occurrence('a'), occurrence('b')]);
      mockEventService.hasRecordedHistory.mockImplementation((id) =>
        Promise.resolve(id === 'b'),
      );

      const result = await service.update(
        'series-1',
        {
          effectiveFrom: '2026-10-11',
          slotBlueprint: [
            {
              name: 'First Service',
              startTime: '09:00',
              durationMinutes: 120,
              dayOffset: 0,
            },
          ],
        },
        'member-1',
      );

      expect(result).toEqual({
        updated: 1,
        recreated: 0,
        skippedWithHistory: 1,
        skipped: [],
      });
      expect(mockEventService.updateOccurrenceInPlace).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a' }),
        [expect.objectContaining({ startTime: '2026-10-11T08:00:00.000Z' })],
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        'EVENT_SERIES_UPDATED',
        expect.anything(),
      );
    });

    describe('moving the series to a new date', () => {
      const at = (id: string, date: string) => ({
        id,
        name: 'Sunday Service',
        seriesOccurrenceDate: date,
        serviceSlots: [{ name: 'First Service' }],
      });

      beforeEach(() => {
        jest.useFakeTimers({ now: new Date('2026-10-12T10:00:00Z') });
        mockSeriesRepo.findOne.mockResolvedValue(
          sunday({ startDate: '2026-11-15', generatedThrough: '2027-01-03' }),
        );
      });
      afterEach(() => jest.useRealTimers());

      it('replaces the upcoming dates with ones on the new schedule, after confirming', async () => {
        mockEventRepo.find.mockResolvedValue([
          at('a', '2026-11-15'),
          at('b', '2026-11-22'),
          at('c', '2026-11-29'),
        ]);
        mockEventService.hasRecordedHistory.mockImplementation((id) =>
          Promise.resolve(id === 'c'),
        );
        const dto = { effectiveFrom: '2026-11-15', moveTo: '2026-10-18' };

        await expect(
          service.update('series-1', dto, 'm'),
        ).rejects.toMatchObject({
          response: { code: 'SERIES_RECREATE_REQUIRED', affected: 2 },
        });
        expect(mockEventRepo.remove).not.toHaveBeenCalled();

        const result = await service.update(
          'series-1',
          { ...dto, confirmRecreate: true },
          'm',
        );
        expect(mockEventRepo.find).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ recurringEventId: 'series-1' }),
          }),
        );
        expect(mockEventRepo.remove).toHaveBeenCalledWith([
          expect.objectContaining({ id: 'a' }),
          expect.objectContaining({ id: 'b' }),
        ]);
        expect(mockSeriesRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({ startDate: '2026-10-18' }),
        );
        const dates = mockEventService.buildOccurrence.mock.calls.map(
          ([f]) => f.seriesOccurrenceDate,
        );
        expect(dates[0]).toBe('2026-10-18');
        expect(dates).toContain('2026-10-25');
        expect(dates.every((d: string) => d <= '2026-12-07')).toBe(true);
        expect(result).toMatchObject({
          movedTo: '2026-10-18',
          skippedWithHistory: 1,
          recreated: dates.length,
        });
      });

      it('refuses a date in the past or after the series ends', async () => {
        await expect(
          service.update(
            'series-1',
            { effectiveFrom: '2026-11-15', moveTo: '2026-10-01' },
            'm',
          ),
        ).rejects.toThrow('from today onwards');
        mockSeriesRepo.findOne.mockResolvedValue(
          sunday({ startDate: '2026-11-15', endDate: '2026-12-31' }),
        );
        await expect(
          service.update(
            'series-1',
            { effectiveFrom: '2026-11-15', moveTo: '2027-01-10' },
            'm',
          ),
        ).rejects.toThrow('after this series ends');
      });

      it('treats the current start date as no move', async () => {
        mockSeriesRepo.findOne.mockResolvedValue(sunday());
        mockEventRepo.find.mockResolvedValue([]);
        const result = await service.update(
          'series-1',
          { effectiveFrom: '2026-10-11', moveTo: '2026-10-04' },
          'm',
        );
        expect(result.movedTo).toBeUndefined();
      });
    });

    it('leaves a date as it was when its new times would clash', async () => {
      mockOverlapService.getRule.mockResolvedValue(EventOverlapRule.BLOCK_ALL);
      mockOverlapService.findClashes.mockImplementation((slots) =>
        Promise.resolve([
          { slot: slots[0], eventName: 'Youth Night', slotName: 'Worship' },
        ]),
      );
      mockEventRepo.find.mockResolvedValue([occurrence('a')]);

      const result = await service.update(
        'series-1',
        {
          effectiveFrom: '2026-10-11',
          slotBlueprint: [
            {
              name: 'First Service',
              startTime: '18:00',
              durationMinutes: 120,
              dayOffset: 0,
            },
          ],
        },
        'm',
      );

      expect(mockEventService.updateOccurrenceInPlace).not.toHaveBeenCalled();
      expect(result.updated).toBe(0);
      expect(mockOverlapService.lockSchedule).toHaveBeenCalled();
      // Its name and description still follow the series; only its time and audience stay.
      expect(mockEventRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a', name: 'Sunday Service' }),
      );
      expect(result.skipped).toEqual([
        expect.objectContaining({
          date: '2026-10-11',
          note: 'Left 2026-10-11 as it was — the new First Service (9–11) overlaps "Youth Night" (Worship, 10–1).',
        }),
      ]);
    });

    it("doesn't check dates whose time, venue and audience aren't changing, so a rename always applies", async () => {
      mockOverlapService.getRule.mockResolvedValue(EventOverlapRule.BLOCK_ALL);
      const same = {
        id: 'a',
        name: 'Old name',
        audience: 'EVERYONE',
        seriesOccurrenceDate: '2026-10-11',
        serviceSlots: [
          {
            name: 'First Service',
            startTime: '2026-10-11T07:00:00.000Z',
            endTime: '2026-10-11T09:00:00.000Z',
          },
        ],
      };
      mockEventRepo.find.mockResolvedValue([same]);
      mockSeriesRepo.findOne.mockResolvedValue(
        sunday({ audience: 'EVERYONE' } as never),
      );

      const result = await service.update(
        'series-1',
        {
          effectiveFrom: '2026-10-11',
          name: 'Sunday Service',
          audience: 'EVERYONE',
          slotBlueprint: [
            {
              name: 'First Service',
              startTime: '08:00',
              durationMinutes: 120,
              dayOffset: 0,
            },
          ],
        } as never,
        'm',
      );

      expect(mockOverlapService.findClashes).not.toHaveBeenCalled();
      expect(result.skipped).toEqual([]);
      expect(result.updated).toBe(1);
    });

    it('asks for confirmation before recreating services when one is added', async () => {
      mockEventRepo.find.mockResolvedValue([occurrence('a')]);
      const blueprint = [
        {
          name: 'First Service',
          startTime: '08:00',
          durationMinutes: 120,
          dayOffset: 0,
        },
        {
          name: 'Second Service',
          startTime: '10:30',
          durationMinutes: 120,
          dayOffset: 0,
        },
      ];

      await expect(
        service.update(
          'series-1',
          { effectiveFrom: '2026-10-11', slotBlueprint: blueprint },
          'm',
        ),
      ).rejects.toThrow(ConflictException);

      const result = await service.update(
        'series-1',
        {
          effectiveFrom: '2026-10-11',
          slotBlueprint: blueprint,
          confirmRecreate: true,
        },
        'm',
      );
      expect(result.recreated).toBe(1);
      expect(mockEventRepo.remove).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a' }),
      );
      expect(mockEventService.buildOccurrence).toHaveBeenCalledWith(
        expect.objectContaining({ seriesOccurrenceDate: '2026-10-11' }),
        expect.arrayContaining([
          expect.objectContaining({ name: 'Second Service' }),
        ]),
      );
    });
  });

  it('stop ends the series and removes upcoming services without history', async () => {
    mockSeriesRepo.findOne.mockResolvedValue(sunday());
    mockEventRepo.find.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    mockEventService.hasRecordedHistory.mockImplementation((id) =>
      Promise.resolve(id === 'b'),
    );

    const result = await service.stop('series-1', '2026-11-01', 'm');

    expect(result).toEqual({ removed: 1 });
    expect(mockSeriesRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ endDate: '2026-10-31', isActive: false }),
    );
    expect(mockEventRepo.remove).toHaveBeenCalledWith([{ id: 'a' }]);
  });
});
