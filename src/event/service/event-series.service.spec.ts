import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { EventSeriesService } from './event-series.service';
import { EventSeries } from '../entity/event-series.entity';
import { Event } from '../entity/event.entity';
import { EventService } from './event.service';
import { ChurchTimezoneService } from './church-timezone.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { EventRecurrencePatternEnum } from '../enums/event-recurrence-patterns.enums';

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
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventSeriesService,
        { provide: getRepositoryToken(EventSeries), useValue: mockSeriesRepo },
        { provide: getRepositoryToken(Event), useValue: mockEventRepo },
        { provide: EventService, useValue: mockEventService },
        { provide: ChurchTimezoneService, useValue: mockTimezone },
        { provide: AuditLogService, useValue: mockAudit },
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
      const created = await service.generate(series, TZ, now);

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

    it('never revisits dates already generated, so a cancelled service stays cancelled', async () => {
      const created = await service.generate(
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

      const created = await service.generate(
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
      jest.spyOn(service, 'generate').mockResolvedValue([]);

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
