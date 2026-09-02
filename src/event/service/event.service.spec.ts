import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
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
};

const mockEventConfigService = {
  get: jest.fn(),
  create: jest.fn(),
};

const mockVenueService = {
  getById: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };

const mockDataSource = {
  createQueryBuilder: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
  }),
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
        eventDate: pastDate,
        serviceSlots: [],
      });

      await expect(
        service.deleteEvent('event-past', 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should delete event when it is a future event', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);
      const event = {
        id: 'event-future',
        eventDate: futureDate,
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
  });

  describe('getUpcomingEvents', () => {
    it('excludes an event whose slots have all already ended today', async () => {
      const now = new Date();
      const pastEvent = {
        id: 'event-past',
        serviceSlots: [{ endTime: new Date(now.getTime() - 60 * 60 * 1000) }],
      };
      const futureEvent = {
        id: 'event-future',
        serviceSlots: [{ endTime: new Date(now.getTime() + 60 * 60 * 1000) }],
      };
      mockEventRepo.find.mockResolvedValue([pastEvent, futureEvent]);

      const result = await service.getUpcomingEvents(5);

      expect(result.map((e: any) => e.id)).toEqual(['event-future']);
    });

    it('includes an event where at least one slot has not yet ended', async () => {
      const now = new Date();
      const event = {
        id: 'event-mixed',
        serviceSlots: [
          { endTime: new Date(now.getTime() - 60 * 60 * 1000) },
          { endTime: new Date(now.getTime() + 60 * 60 * 1000) },
        ],
      };
      mockEventRepo.find.mockResolvedValue([event]);

      const result = await service.getUpcomingEvents(5);

      expect(result.map((e: any) => e.id)).toEqual(['event-mixed']);
    });

    it('includes an event with no slots yet scheduled', async () => {
      const event = { id: 'event-no-slots', serviceSlots: [] };
      mockEventRepo.find.mockResolvedValue([event]);

      const result = await service.getUpcomingEvents(5);

      expect(result.map((e: any) => e.id)).toEqual(['event-no-slots']);
    });

    it('respects the limit after filtering', async () => {
      const now = new Date();
      const futureSlot = [
        { endTime: new Date(now.getTime() + 60 * 60 * 1000) },
      ];
      mockEventRepo.find.mockResolvedValue([
        { id: 'e1', serviceSlots: futureSlot },
        { id: 'e2', serviceSlots: futureSlot },
        { id: 'e3', serviceSlots: futureSlot },
      ]);

      const result = await service.getUpcomingEvents(2);

      expect(result).toHaveLength(2);
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
  });
});
