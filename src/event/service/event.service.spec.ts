import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, MoreThanOrEqual } from 'typeorm';
import { EventService } from './event.service';
import { Event } from '../entity/event.entity';
import { ServiceSlot } from '../entity/service-slot.entity';
import { EventConfigService } from './event-config.service';
import { VenueService } from '../../venue/service/venue.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { MeetingFormatEnum } from '../../utility/enum/meeting-format.enum';

const mockEventRepo = {
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockSlotRepo = {
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  createQueryBuilder: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

const mockEventConfigService = {
  get: jest.fn(),
  create: jest.fn(),
};

const mockVenueService = {
  getById: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };

function makeQb(rawOneResult: unknown = undefined) {
  return {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(rawOneResult),
    getRawMany: jest.fn().mockResolvedValue([]),
  };
}

const mockDataSource = {
  // Default: a fresh, empty query builder for every call — safe "nothing
  // found" behavior for tests that don't specifically exercise
  // hasRecordedHistory's two sequential queries.
  createQueryBuilder: jest.fn().mockImplementation(() => makeQb()),
};

const defaultVenue = {
  id: 'venue-1',
  name: 'Main Auditorium',
  latitude: 6.5244,
  longitude: 3.3792,
};

describe('EventService', () => {
  let service: EventService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: getRepositoryToken(Event), useValue: mockEventRepo },
        { provide: getRepositoryToken(ServiceSlot), useValue: mockSlotRepo },
        { provide: EventConfigService, useValue: mockEventConfigService },
        { provide: VenueService, useValue: mockVenueService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<EventService>(EventService);
  });

  describe('create', () => {
    it('should throw BadRequestException for an invalid slot startTime', async () => {
      await expect(
        service.create(
          {
            name: 'Test',
            isRecurring: false,
            serviceSlots: [
              { startTime: 'not-a-date', endTime: '2025-06-01T11:00:00.000Z' },
            ],
          } as any,
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException if the config's checkinStopOffsetSeconds would leave check-in open past this slot's own end", async () => {
      mockEventConfigService.get.mockResolvedValue({
        id: 'config-1',
        defaultFormat: MeetingFormatEnum.ONLINE,
        checkinStopOffsetSeconds: 3600, // closes 1 hour after start
      });

      await expect(
        service.create(
          {
            name: 'Test',
            isRecurring: false,
            serviceSlots: [
              {
                startTime: '2025-06-01T09:00:00.000Z',
                endTime: '2025-06-01T09:30:00.000Z', // only a 30-minute slot
                configId: 'config-1',
              },
            ],
          } as any,
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException if checkinStopOverride would leave check-in open past this slot's own end", async () => {
      await expect(
        service.create(
          {
            name: 'Test',
            isRecurring: false,
            serviceSlots: [
              {
                startTime: '2025-06-01T09:00:00.000Z',
                endTime: '2025-06-01T09:30:00.000Z', // 1800s slot
                checkinStopOverride: 1801,
              },
            ],
          } as any,
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a checkinStopOffsetSeconds that does not exceed the slot duration', async () => {
      mockEventConfigService.get.mockResolvedValue({
        id: 'config-1',
        defaultFormat: MeetingFormatEnum.ONLINE,
        checkinStopOffsetSeconds: 1800,
      });
      const slotObj = {
        name: 'Service',
        startTime: new Date('2025-06-01T09:00:00.000Z'),
        endTime: new Date('2025-06-01T09:30:00.000Z'),
      };
      mockSlotRepo.create.mockReturnValue(slotObj);
      mockEventRepo.create.mockImplementation((data) => ({
        ...data,
        serviceSlots: [],
      }));
      mockEventRepo.save.mockResolvedValue({
        id: 'event-1',
        serviceSlots: [slotObj],
      });

      await expect(
        service.create(
          {
            name: 'Test',
            isRecurring: false,
            serviceSlots: [
              {
                startTime: '2025-06-01T09:00:00.000Z',
                endTime: '2025-06-01T09:30:00.000Z',
                configId: 'config-1',
              },
            ],
          } as any,
          'actor-1',
        ),
      ).resolves.toBeDefined();
    });

    it('should create a single event and derive eventDate/endDate from the slots', async () => {
      const slotDto = {
        name: 'First Service',
        startTime: '2025-06-01T09:00:00.000Z',
        endTime: '2025-06-01T11:00:00.000Z',
      };
      const slotObj = {
        name: 'First Service',
        startTime: new Date(slotDto.startTime),
        endTime: new Date(slotDto.endTime),
      };
      const savedEvent = {
        id: 'event-1',
        name: 'Sunday Service',
        eventDate: new Date('2025-06-01'),
        serviceSlots: [slotObj],
      };

      mockSlotRepo.create.mockReturnValue(slotObj);
      mockEventRepo.create.mockImplementation((data) => ({
        ...data,
        serviceSlots: [],
      }));
      mockEventRepo.save.mockResolvedValue(savedEvent);

      const result = await service.create(
        {
          name: 'Sunday Service',
          isRecurring: false,
          serviceSlots: [slotDto],
        } as any,
        'actor-1',
      );

      expect(mockEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventDate: new Date('2025-06-01T00:00:00.000Z'),
          endDate: new Date('2025-06-01T00:00:00.000Z'),
          startTime: new Date(slotDto.startTime),
          endTime: new Date(slotDto.endTime),
        }),
      );
      expect(mockEventRepo.save).toHaveBeenCalled();
      expect(result).toMatchObject({ id: 'event-1' });
    });

    it('should throw BadRequestException when recurring event requires recurrence but it is missing', async () => {
      await expect(
        service.create(
          {
            name: 'Weekly Service',
            isRecurring: true,
            recurrence: undefined,
          } as any,
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create recurring events correctly when valid recurrence is provided', async () => {
      mockSlotRepo.create.mockImplementation((d: any) => ({
        ...d,
        startTime: new Date(d.startTime),
        endTime: new Date(d.endTime),
      }));
      mockEventRepo.create.mockImplementation((data) => ({
        ...data,
        serviceSlots: [],
      }));
      mockEventRepo.save.mockImplementation((events) =>
        Promise.resolve(
          Array.isArray(events)
            ? events.map((e, i) => ({ ...e, id: `event-${i}` }))
            : {
                ...events,
                id: 'event-0',
              },
        ),
      );

      const result = await service.create(
        {
          name: 'Weekly Service',
          isRecurring: true,
          recurrence: {
            recurrenceEndDate: '2025-06-22',
            recurrencePattern: 'weekly',
            recurrenceInterval: 1,
          },
          serviceSlots: [
            {
              startTime: '2025-06-01T09:00:00.000Z',
              endTime: '2025-06-01T11:00:00.000Z',
            },
          ],
        } as any,
        'actor-1',
      );

      expect(Array.isArray(result)).toBe(true);
      expect((result as Event[]).length).toBeGreaterThanOrEqual(1);
    });

    // Regression test: advanceDate used to use date-fns' addDays/addWeeks/
    // addMonths, which advance by the *runtime's local* calendar — a DST
    // transition between occurrences would skew the millisecond delta
    // applied to each slot's absolute startTime/endTime by up to an hour.
    // Every weekly occurrence's slot must land exactly 7 days apart,
    // regardless of what timezone the test (or production) process runs in.
    it('advances recurring occurrences by exact UTC calendar days, immune to runtime-local DST drift', async () => {
      mockSlotRepo.create.mockImplementation((d: any) => ({
        ...d,
        startTime: new Date(d.startTime),
        endTime: new Date(d.endTime),
      }));
      mockEventRepo.create.mockImplementation((data) => ({
        ...data,
        serviceSlots: [{ startTime: data.startTime, endTime: data.endTime }],
      }));
      mockEventRepo.save.mockImplementation((events) =>
        Promise.resolve(events),
      );

      const result = (await service.create(
        {
          name: 'Weekly Service',
          isRecurring: true,
          recurrence: {
            recurrenceEndDate: '2025-06-29',
            recurrencePattern: 'weekly',
            recurrenceInterval: 1,
          },
          serviceSlots: [
            {
              startTime: '2025-06-01T09:00:00.000Z',
              endTime: '2025-06-01T11:00:00.000Z',
            },
          ],
        } as any,
        'actor-1',
      )) as Event[];

      expect(result.length).toBeGreaterThanOrEqual(2);
      const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
      for (let i = 1; i < result.length; i++) {
        expect(
          result[i].serviceSlots[0].startTime.getTime() -
            result[i - 1].serviceSlots[0].startTime.getTime(),
        ).toBe(ONE_WEEK_MS);
      }
    });

    it('should throw BadRequestException when recurrence end date is more than 1 year away', async () => {
      mockSlotRepo.create.mockImplementation((d: any) => ({
        ...d,
        startTime: new Date(d.startTime),
        endTime: new Date(d.endTime),
      }));

      await expect(
        service.create(
          {
            name: 'Long Recurring Service',
            isRecurring: true,
            recurrence: {
              recurrenceEndDate: '2027-06-01',
              recurrencePattern: 'weekly',
              recurrenceInterval: 1,
            },
            serviceSlots: [
              {
                startTime: '2025-06-01T09:00:00.000Z',
                endTime: '2025-06-01T11:00:00.000Z',
              },
            ],
          } as any,
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when slots overlap', async () => {
      mockSlotRepo.create.mockImplementation((d) => ({
        ...d,
        startTime: new Date(d.startTime),
        endTime: new Date(d.endTime),
      }));

      await expect(
        service.create(
          {
            name: 'Overlapping',
            isRecurring: false,
            serviceSlots: [
              {
                name: 'First',
                startTime: '2025-06-01T09:00:00.000Z',
                endTime: '2025-06-01T11:00:00.000Z',
              },
              {
                name: 'Second',
                startTime: '2025-06-01T10:00:00.000Z',
                endTime: '2025-06-01T12:00:00.000Z',
              },
            ],
          } as any,
          'actor-1',
        ),
      ).rejects.toThrow('overlaps');
    });

    it('should accept slots where startTime of second equals endTime of first', async () => {
      mockSlotRepo.create.mockImplementation((d) => ({
        ...d,
        startTime: new Date(d.startTime),
        endTime: new Date(d.endTime),
      }));
      mockEventRepo.create.mockReturnValue({
        name: 'Back to Back',
        serviceSlots: [],
      });
      mockEventRepo.save.mockResolvedValue({
        id: 'event-1',
        name: 'Back to Back',
      });

      await expect(
        service.create(
          {
            name: 'Back to Back',
            isRecurring: false,
            serviceSlots: [
              {
                name: 'First',
                startTime: '2025-06-01T09:00:00.000Z',
                endTime: '2025-06-01T11:00:00.000Z',
              },
              {
                name: 'Second',
                startTime: '2025-06-01T11:00:00.000Z',
                endTime: '2025-06-01T13:00:00.000Z',
              },
            ],
          } as any,
          'actor-1',
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('update', () => {
    const existingEvent = {
      id: 'event-1',
      name: 'Sunday Service',
      description: 'Old description',
      serviceSlots: [],
    };

    it('updates name/description without touching history checks when serviceSlots is omitted', async () => {
      mockEventRepo.findOne.mockResolvedValue({ ...existingEvent });
      mockEventRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update(
        'event-1',
        { name: 'New Name' } as any,
        'actor-1',
      );

      expect(result.name).toBe('New Name');
      expect(mockDataSource.createQueryBuilder).not.toHaveBeenCalled();
      expect(mockSlotRepo.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException and does not touch slots when the event has recorded attendance', async () => {
      mockEventRepo.findOne.mockResolvedValue({ ...existingEvent });
      mockDataSource.createQueryBuilder
        .mockImplementationOnce(() => makeQb({ x: 1 })) // attendance found
        .mockImplementationOnce(() => makeQb(undefined));

      await expect(
        service.update(
          'event-1',
          {
            serviceSlots: [
              {
                name: 'First Service',
                startTime: '2025-06-01T09:00:00.000Z',
                endTime: '2025-06-01T10:00:00.000Z',
              },
            ],
          } as any,
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockSlotRepo.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when a slot on this event has a recorded service session', async () => {
      mockEventRepo.findOne.mockResolvedValue({ ...existingEvent });
      mockDataSource.createQueryBuilder
        .mockImplementationOnce(() => makeQb(undefined)) // no attendance
        .mockImplementationOnce(() => makeQb({ x: 1 })); // session found

      await expect(
        service.update(
          'event-1',
          {
            serviceSlots: [
              {
                name: 'First Service',
                startTime: '2025-06-01T09:00:00.000Z',
                endTime: '2025-06-01T10:00:00.000Z',
              },
            ],
          } as any,
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockSlotRepo.delete).not.toHaveBeenCalled();
    });

    it('allows replacing slots when the event has no recorded history', async () => {
      mockEventRepo.findOne.mockResolvedValue({ ...existingEvent });
      mockDataSource.createQueryBuilder
        .mockImplementationOnce(() => makeQb(undefined))
        .mockImplementationOnce(() => makeQb(undefined));
      const slotDto = {
        name: 'First Service',
        startTime: '2025-06-01T09:00:00.000Z',
        endTime: '2025-06-01T10:00:00.000Z',
      };
      const slotObj = {
        name: 'First Service',
        startTime: new Date(slotDto.startTime),
        endTime: new Date(slotDto.endTime),
      };
      mockSlotRepo.create.mockReturnValue(slotObj);
      mockEventRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update(
        'event-1',
        { serviceSlots: [slotDto] } as any,
        'actor-1',
      );

      expect(mockSlotRepo.delete).toHaveBeenCalledWith({
        event: { id: 'event-1' },
      });
      expect(result.serviceSlots).toEqual([slotObj]);
    });
  });

  describe('getById', () => {
    it('should throw NotFoundException if event not found', async () => {
      mockEventRepo.findOne.mockResolvedValue(null);

      await expect(service.getById('nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return event when found', async () => {
      const event = { id: 'event-1', name: 'Sunday Service', serviceSlots: [] };
      mockEventRepo.findOne.mockResolvedValue(event);

      const result = await service.getById('event-1');

      expect(result).toEqual(event);
    });

    it('should include venue relations in query', async () => {
      const event = { id: 'event-1', name: 'Sunday Service', serviceSlots: [] };
      mockEventRepo.findOne.mockResolvedValue(event);

      await service.getById('event-1');

      expect(mockEventRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        relations: [
          'serviceSlots',
          'serviceSlots.config',
          'serviceSlots.config.defaultVenue',
          'serviceSlots.venueOverride',
        ],
        order: { serviceSlots: { startTime: 'ASC' } },
      });
    });
  });

  describe('deleteEvent', () => {
    it('should throw NotFoundException if event not found', async () => {
      mockEventRepo.findOne.mockResolvedValue(null);

      await expect(
        service.deleteEvent('nonexistent-id', 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for past events', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      mockEventRepo.findOne.mockResolvedValue({
        id: 'event-past',
        endTime: pastDate,
        serviceSlots: [],
      });

      await expect(
        service.deleteEvent('event-past', 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    // Regression test: blocking on eventDate (date-only, the event's
    // START date) let a same-day event that had already fully ended hours
    // ago still be deleted, since its calendar date hadn't rolled over yet.
    it('should throw BadRequestException for an event that started today but has already ended', async () => {
      const endedAnHourAgo = new Date();
      endedAnHourAgo.setHours(endedAnHourAgo.getHours() - 1);
      mockEventRepo.findOne.mockResolvedValue({
        id: 'event-ended-today',
        endTime: endedAnHourAgo,
        serviceSlots: [],
      });

      await expect(
        service.deleteEvent('event-ended-today', 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should delete event when it is a future event', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);
      const event = {
        id: 'event-future',
        endTime: futureDate,
        serviceSlots: [],
      };
      mockEventRepo.findOne.mockResolvedValue(event);
      mockEventRepo.remove.mockResolvedValue(undefined);

      await service.deleteEvent('event-future', 'actor-1');

      expect(mockEventRepo.remove).toHaveBeenCalledWith(event);
    });
  });

  describe('resolveSlotConfig', () => {
    it('should throw BadRequestException if slot has no config', () => {
      const slot = {
        id: 'slot-1',
        name: 'Sunday Service',
        config: null,
        workerCheckinStartOverride: null,
        workerLateOverride: null,
        memberCheckinStartOverride: null,
        checkinStopOverride: null,
        allowedDistanceOverride: null,
        venueOverride: null,
      } as any;

      expect(() => service.resolveSlotConfig(slot)).toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if no venue is configured', () => {
      const config = {
        workerCheckinStartOffsetSeconds: -7200,
        workerLateOffsetSeconds: 0,
        memberCheckinStartOffsetSeconds: -3600,
        checkinStopOffsetSeconds: 7200,
        allowedDistanceInMeters: 100,
        defaultVenue: null,
        defaultFormat: MeetingFormatEnum.IN_PERSON,
      } as any;

      const slot = {
        id: 'slot-1',
        name: 'Service',
        config,
        venueOverride: null,
        formatOverride: null,
        workerCheckinStartOverride: null,
        workerLateOverride: null,
        memberCheckinStartOverride: null,
        checkinStopOverride: null,
        allowedDistanceOverride: null,
      } as any;

      expect(() => service.resolveSlotConfig(slot)).toThrow(
        BadRequestException,
      );
    });

    it('should not require a venue when the resolved format is ONLINE', () => {
      const config = {
        workerCheckinStartOffsetSeconds: -7200,
        workerLateOffsetSeconds: 0,
        memberCheckinStartOffsetSeconds: -3600,
        checkinStopOffsetSeconds: 7200,
        allowedDistanceInMeters: 100,
        defaultVenue: null,
        defaultFormat: MeetingFormatEnum.ONLINE,
        onlineMeetingUrl: 'https://zoom.example/live',
      } as any;

      const slot = {
        id: 'slot-1',
        name: 'Service',
        config,
        venueOverride: null,
        formatOverride: null,
        workerCheckinStartOverride: null,
        workerLateOverride: null,
        memberCheckinStartOverride: null,
        checkinStopOverride: null,
        allowedDistanceOverride: null,
      } as any;

      const result = service.resolveSlotConfig(slot);

      expect(result.venue).toBeNull();
      expect(result.format).toBe(MeetingFormatEnum.ONLINE);
      expect(result.onlineMeetingUrl).toBe('https://zoom.example/live');
    });

    it('should use venueOverride when present and fall back to config.defaultVenue', () => {
      const overrideVenue = {
        id: 'venue-2',
        name: 'Chapel',
        latitude: 6.6,
        longitude: 3.4,
      };
      const config = {
        workerCheckinStartOffsetSeconds: -7200,
        workerLateOffsetSeconds: 0,
        memberCheckinStartOffsetSeconds: -3600,
        checkinStopOffsetSeconds: 7200,
        allowedDistanceInMeters: 100,
        defaultVenue,
        defaultFormat: MeetingFormatEnum.IN_PERSON,
      } as any;

      const slot = {
        id: 'slot-1',
        name: 'Service',
        config,
        venueOverride: overrideVenue,
        workerCheckinStartOverride: -3600,
        workerLateOverride: 300,
        memberCheckinStartOverride: -1800,
        checkinStopOverride: 3600,
        allowedDistanceOverride: 50,
      } as any;

      const result = service.resolveSlotConfig(slot);

      expect(result.venue).toEqual(overrideVenue);
      expect(result.workerCheckinStartOffsetSeconds).toBe(-3600);
      expect(result.workerLateOffsetSeconds).toBe(300);
      expect(result.allowedDistanceInMeters).toBe(50);
    });

    it('should use config.defaultVenue when venueOverride is null', () => {
      const config = {
        workerCheckinStartOffsetSeconds: -7200,
        workerLateOffsetSeconds: 0,
        memberCheckinStartOffsetSeconds: -3600,
        checkinStopOffsetSeconds: 7200,
        allowedDistanceInMeters: 100,
        defaultVenue,
        defaultFormat: MeetingFormatEnum.IN_PERSON,
      } as any;

      const slot = {
        id: 'slot-1',
        name: 'Service',
        config,
        venueOverride: null,
        workerCheckinStartOverride: null,
        workerLateOverride: null,
        memberCheckinStartOverride: null,
        checkinStopOverride: null,
        allowedDistanceOverride: null,
      } as any;

      const result = service.resolveSlotConfig(slot);

      expect(result.venue).toEqual(defaultVenue);
      expect(result.workerCheckinStartOffsetSeconds).toBe(-7200);
      expect(result.workerLateOffsetSeconds).toBe(0);
      expect(result.memberCheckinStartOffsetSeconds).toBe(-3600);
      expect(result.checkinStopOffsetSeconds).toBe(7200);
      expect(result.allowedDistanceInMeters).toBe(100);
    });

    it('resolves enforceMemberLocation from the config when the slot has no override', () => {
      const config = {
        workerCheckinStartOffsetSeconds: -7200,
        workerLateOffsetSeconds: 0,
        memberCheckinStartOffsetSeconds: -3600,
        checkinStopOffsetSeconds: 7200,
        allowedDistanceInMeters: 100,
        defaultVenue,
        defaultFormat: MeetingFormatEnum.IN_PERSON,
        enforceMemberLocation: true,
      } as any;
      const slot = {
        id: 'slot-1',
        name: 'Service',
        config,
        venueOverride: null,
        workerCheckinStartOverride: null,
        workerLateOverride: null,
        memberCheckinStartOverride: null,
        checkinStopOverride: null,
        allowedDistanceOverride: null,
        enforceMemberLocationOverride: null,
      } as any;

      expect(service.resolveSlotConfig(slot).enforceMemberLocation).toBe(true);
    });

    it('lets a slot override enforceMemberLocation independently of its config', () => {
      const config = {
        workerCheckinStartOffsetSeconds: -7200,
        workerLateOffsetSeconds: 0,
        memberCheckinStartOffsetSeconds: -3600,
        checkinStopOffsetSeconds: 7200,
        allowedDistanceInMeters: 100,
        defaultVenue,
        defaultFormat: MeetingFormatEnum.IN_PERSON,
        enforceMemberLocation: true,
      } as any;
      const slot = {
        id: 'slot-1',
        name: 'Service',
        config,
        venueOverride: null,
        workerCheckinStartOverride: null,
        workerLateOverride: null,
        memberCheckinStartOverride: null,
        checkinStopOverride: null,
        allowedDistanceOverride: null,
        enforceMemberLocationOverride: false,
      } as any;

      expect(service.resolveSlotConfig(slot).enforceMemberLocation).toBe(false);
    });
  });

  describe('getUpcomingEvents', () => {
    it('queries by event.endTime >= now, ordered by startTime, limited', async () => {
      mockEventRepo.find.mockResolvedValue([]);

      await service.getUpcomingEvents(5);

      expect(mockEventRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { endTime: MoreThanOrEqual(expect.any(Date)) },
          order: { startTime: 'ASC', serviceSlots: { startTime: 'ASC' } },
          take: 5,
        }),
      );
    });

    it('returns whatever events the repository resolves, defaulting the limit to 5', async () => {
      const events = [{ id: 'event-future' }];
      mockEventRepo.find.mockResolvedValue(events);

      const result = await service.getUpcomingEvents();

      expect(result).toBe(events);
      expect(mockEventRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });
  });

  describe('findEventsReadyForAbsenceMarking', () => {
    it('filters on event.endTime < now rather than the date-only endDate', async () => {
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      mockEventRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findEventsReadyForAbsenceMarking();

      expect(qb.andWhere).toHaveBeenCalledWith('event.endTime < :now', {
        now: expect.any(Date),
      });
    });
  });

  describe('getAll', () => {
    const makeQb = () => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    });

    it('orders service slots by start time', async () => {
      const qb = makeQb();
      mockEventRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getAll(1, 10, 'eventDate', 'DESC', {});

      expect(qb.addOrderBy).toHaveBeenCalledWith(
        'serviceSlots.startTime',
        'ASC',
      );
    });

    it('applies a name search filter when provided', async () => {
      const qb = makeQb();
      mockEventRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getAll(1, 10, 'eventDate', 'DESC', { search: 'Picnic' });

      expect(qb.andWhere).toHaveBeenCalledWith('event.name ILIKE :search', {
        search: '%Picnic%',
      });
    });

    it('does not apply a search filter when omitted', async () => {
      const qb = makeQb();
      mockEventRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getAll(1, 10, 'eventDate', 'DESC', {});

      expect(qb.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        expect.anything(),
      );
    });

    // Regression test: the upcoming filter used to compare event.eventDate
    // (date-only) to today's midnight, so an event that had already fully
    // ended earlier today still matched "upcoming" until the next calendar
    // day. Must use the precise endTime instead.
    it('filters on event.endTime >= now, not the date-only eventDate, when upcoming is set', async () => {
      const qb = makeQb();
      mockEventRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getAll(1, 10, 'eventDate', 'DESC', { upcoming: true });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'event.endTime >= :upcomingFrom',
        { upcomingFrom: expect.any(Date) },
      );
    });
  });

  describe('deleteFutureRecurring', () => {
    // Regression test: this used to select on event.eventDate >= today
    // (date-only), so a same-day occurrence that had already started (or
    // ended) was still treated as "future" and deleted. Also previously had
    // no attendanceMarked guard at all, unlike deleteEvent's own check.
    it('filters on startTime >= now and attendanceMarked = false, not the date-only eventDate', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ id: 'e1', name: 'Service' }]),
      };
      mockEventRepo.createQueryBuilder.mockReturnValue(qb);
      mockEventRepo.remove.mockResolvedValue(undefined);

      await service.deleteFutureRecurring('recurring-1', 'actor-1');

      expect(qb.andWhere).toHaveBeenCalledWith('event.startTime >= :now', {
        now: expect.any(Date),
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'event.attendanceMarked = false',
      );
    });

    it('throws NotFoundException when no future occurrences remain', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      mockEventRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(
        service.deleteFutureRecurring('recurring-1', 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
