import { TransactionHost } from '@nestjs-cls/transactional';
import { EventReminder } from '../entity/event-reminder.entity';
import { EventAudienceEnum } from '../enums/event-audience.enum';
import { Group } from '../../group/entity/group.entity';
import { CheckinCloseModeEnum } from '../enums/checkin-close-mode.enum';
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
const mockSeriesService = {
  createFromEvent: jest.fn(),
  deactivate: jest.fn().mockResolvedValue(undefined),
};
const mockProgrammeService = {
  createDraftsFromTemplates: jest.fn().mockResolvedValue([]),
};

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

const mockReminderRepo = {
  find: jest.fn().mockResolvedValue([]),
  save: jest.fn((v) => Promise.resolve(v)),
};
const mockGroupRepo = { existsBy: jest.fn().mockResolvedValue(true) };

// The request's tenant transaction; by default it answers like the DataSource mock.
const mockTenantTx = {
  query: jest.fn().mockResolvedValue([]),
  createQueryBuilder: jest.fn((...args: unknown[]) =>
    mockDataSource.createQueryBuilder(...args),
  ),
};

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

import { EventSeriesService } from './event-series.service';
import { ServiceProgrammeService } from '../../service-programme/service/service-programme.service';
describe('EventService', () => {
  let service: EventService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventService,
        { provide: DataSource, useValue: mockDataSource },
        // Tenant queries run on the request's transaction, which the old DataSource mock stands in for.
        { provide: TransactionHost, useValue: { tx: mockTenantTx } },
        { provide: getRepositoryToken(Event), useValue: mockEventRepo },
        { provide: getRepositoryToken(ServiceSlot), useValue: mockSlotRepo },
        { provide: getRepositoryToken(Group), useValue: mockGroupRepo },
        {
          provide: getRepositoryToken(EventReminder),
          useValue: mockReminderRepo,
        },
        { provide: EventConfigService, useValue: mockEventConfigService },
        { provide: VenueService, useValue: mockVenueService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: EventSeriesService, useValue: mockSeriesService },
        { provide: ServiceProgrammeService, useValue: mockProgrammeService },
      ],
    }).compile();

    service = module.get<EventService>(EventService);
  });

  describe('create', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('rejects creating an event with a slot in the past', async () => {
      await expect(
        service.create(
          {
            name: 'Past Service',
            isRecurring: false,
            serviceSlots: [
              {
                startTime: '2024-12-31T23:00:00.000Z',
                endTime: '2024-12-31T23:30:00.000Z',
              },
            ],
          } as any,
          'actor-1',
        ),
      ).rejects.toThrow('Service slots cannot start in the past');
    });

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

    it('accepts a config whose check-in stop is longer than the service — check-in just closes when it ends', async () => {
      mockEventConfigService.get.mockResolvedValue({
        id: 'config-1',
        defaultFormat: MeetingFormatEnum.ONLINE,
        checkinStopOffsetSeconds: 3600,
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

    it('hands recurring events to the series service', async () => {
      mockSeriesService.createFromEvent.mockResolvedValue([
        { id: 'event-0' },
        { id: 'event-1' },
      ]);
      const dto = {
        name: 'Weekly Service',
        isRecurring: true,
        recurrence: {
          recurrencePattern: 'weekly',
          recurrenceInterval: 1,
          ongoing: true,
        },
        serviceSlots: [
          {
            startTime: new Date(Date.now() + 86_400_000).toISOString(),
            endTime: new Date(Date.now() + 90_000_000).toISOString(),
          },
        ],
      } as any;

      const result = await service.create(dto, 'actor-1');

      expect(mockSeriesService.createFromEvent).toHaveBeenCalledWith(
        { ...dto, audience: 'EVERYONE', audienceGroupId: null },
        'actor-1',
      );
      expect(result).toHaveLength(2);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'EVENT_CREATED',
        expect.objectContaining({
          metadata: expect.objectContaining({ ongoing: true, count: 2 }),
        }),
      );
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
          'audienceGroup',
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

  it("reads the member's check-in from the church's schema, not public", async () => {
    mockEventRepo.findOne.mockResolvedValue({
      id: 'e1',
      serviceSlots: [{ id: 's1', name: 'First Service' }],
    });
    const rowsQb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest
        .fn()
        .mockResolvedValue([
          { eventId: 'e1', slotId: 's1', status: 'PRESENT', checkinTime: null },
        ]),
    };
    mockTenantTx.createQueryBuilder.mockReturnValueOnce(rowsQb);
    (mockDataSource.createQueryBuilder as jest.Mock).mockClear();

    const event = await service.getById('e1', 'member-1');

    expect(event.checkedIn).toBe(true);
    expect(event.myCheckin?.slotName).toBe('First Service');
    expect(mockDataSource.createQueryBuilder).not.toHaveBeenCalled();
  });

  describe('audience', () => {
    it('keeps no group unless the event is for a group', async () => {
      await expect(
        service.resolveAudience({
          audience: EventAudienceEnum.WORKERS,
          audienceGroupId: 'g1',
        }),
      ).resolves.toEqual({
        audience: EventAudienceEnum.WORKERS,
        audienceGroupId: null,
      });
    });

    it('rejects a group audience without an existing group', async () => {
      mockGroupRepo.existsBy.mockResolvedValueOnce(false);
      await expect(
        service.resolveAudience({
          audience: EventAudienceEnum.GROUP,
          audienceGroupId: 'missing',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('hides a workers-only event from a member in the member app', async () => {
      mockEventRepo.findOne.mockResolvedValue({
        id: 'e1',
        audience: EventAudienceEnum.WORKERS,
        serviceSlots: [],
      });
      await expect(
        service.getById('e1', undefined, { id: 'm1', isWorker: false }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.getById('e1', undefined, { id: 'w1', isWorker: true }),
      ).resolves.toEqual(expect.objectContaining({ id: 'e1' }));
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

    it("uses a service's own close rule over its config's", () => {
      const slot = {
        id: 'slot-1',
        name: 'Service',
        config: {
          defaultFormat: MeetingFormatEnum.ONLINE,
          checkinStopOffsetSeconds: 3600,
          checkinCloseMode: CheckinCloseModeEnum.AFTER_START,
        },
        venueOverride: null,
        formatOverride: null,
        checkinStopOverride: null,
        checkinCloseModeOverride: CheckinCloseModeEnum.SERVICE_END,
      } as any;

      expect(service.resolveSlotConfig(slot).checkinCloseMode).toBe(
        CheckinCloseModeEnum.SERVICE_END,
      );
      expect(
        service.resolveSlotConfig({ ...slot, checkinCloseModeOverride: null })
          .checkinCloseMode,
      ).toBe(CheckinCloseModeEnum.AFTER_START);
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

    // Regression test: attachMyAttendance's "am I checked in" query used to
    // only recognize PRESENT/LATE, disagreeing with AttendanceService.
    // checkin()'s own GENUINELY_ATTENDED_STATUSES (which also includes
    // ATTENDED_ONLINE) — a member who confirmed online attendance would
    // still see the check-in button/icon as available.
    it('attaches attendance status using PRESENT/LATE/ATTENDED_ONLINE, matching AttendanceService', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([
        [{ id: 'event-1', serviceSlots: [] }],
        1,
      ]);
      mockEventRepo.createQueryBuilder.mockReturnValue(qb);
      const attendanceQb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      mockDataSource.createQueryBuilder.mockReturnValue(attendanceQb);

      await service.getAll(1, 10, 'eventDate', 'DESC', {
        memberId: 'member-1',
      });

      expect(attendanceQb.andWhere).toHaveBeenCalledWith(
        `a.status IN ('PRESENT', 'LATE', 'ATTENDED_ONLINE')`,
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

      expect(mockSeriesService.deactivate).toHaveBeenCalledWith('recurring-1');
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

  describe('programmes from templates', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
      mockSlotRepo.create.mockImplementation((d: any) => ({
        ...d,
        startTime: new Date(d.startTime),
        endTime: new Date(d.endTime),
      }));
      mockEventRepo.create.mockImplementation((data) => ({ ...data }));
      mockEventRepo.save.mockImplementation((e) =>
        Promise.resolve({ ...e, id: 'event-1' }),
      );
    });

    afterEach(() => jest.useRealTimers());

    const dto = {
      name: 'Sunday Service',
      isRecurring: false,
      serviceSlots: [
        {
          name: 'First Service',
          startTime: '2025-06-01T07:00:00.000Z',
          endTime: '2025-06-01T09:00:00.000Z',
        },
      ],
    } as any;

    it('prepares draft programmes for a new event by default', async () => {
      await service.create(dto, 'actor-1');

      expect(
        mockProgrammeService.createDraftsFromTemplates,
      ).toHaveBeenCalledWith([
        expect.objectContaining({ name: 'First Service' }),
      ]);
    });

    it('skips them when the admin opts out', async () => {
      await service.create({ ...dto, autoProgramme: false }, 'actor-1');

      expect(
        mockProgrammeService.createDraftsFromTemplates,
      ).not.toHaveBeenCalled();
    });

    it('still creates the event when preparing programmes fails', async () => {
      mockProgrammeService.createDraftsFromTemplates.mockRejectedValueOnce(
        new Error('boom'),
      );

      await expect(service.create(dto, 'actor-1')).resolves.toMatchObject({
        id: 'event-1',
      });
    });
  });

  describe('updateOccurrenceInPlace', () => {
    it('moves existing services by name so their programmes stay attached', async () => {
      mockSlotRepo.create.mockImplementation((d: any) => ({
        ...d,
        startTime: new Date(d.startTime),
        endTime: new Date(d.endTime),
      }));
      mockSlotRepo.save.mockImplementation((v) => Promise.resolve(v));
      mockEventRepo.save.mockImplementation((v) => Promise.resolve(v));
      const existing = {
        id: 'slot-1',
        name: 'First Service',
        startTime: new Date('2025-06-01T07:00:00.000Z'),
      };
      const event = {
        id: 'event-1',
        name: 'Sunday',
        serviceSlots: [existing],
      } as any;
      const reminder = {
        serviceSlot: { id: 'slot-1' },
        intervalPreset: '1h',
        fireAt: new Date('2025-06-01T06:00:00.000Z'),
      };
      mockReminderRepo.find.mockResolvedValueOnce([reminder]);

      const saved = await service.updateOccurrenceInPlace(event, [
        {
          name: 'First Service',
          startTime: '2025-06-01T08:00:00.000Z',
          endTime: '2025-06-01T10:00:00.000Z',
        },
      ]);

      expect(saved.serviceSlots[0]).toBe(existing);
      expect(existing).toEqual(
        expect.objectContaining({
          id: 'slot-1',
          startTime: new Date('2025-06-01T08:00:00.000Z'),
        }),
      );
      expect(saved.startTime).toEqual(new Date('2025-06-01T08:00:00.000Z'));
      expect(mockReminderRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({
          fireAt: new Date('2025-06-01T07:00:00.000Z'),
        }),
      ]);
    });

    it('refuses a service the occurrence does not have', async () => {
      mockSlotRepo.create.mockImplementation((d: any) => ({
        ...d,
        startTime: new Date(d.startTime),
        endTime: new Date(d.endTime),
      }));
      await expect(
        service.updateOccurrenceInPlace(
          {
            id: 'e',
            name: 'Sunday',
            serviceSlots: [
              {
                name: 'First Service',
                startTime: new Date('2025-06-01T07:00:00.000Z'),
              },
            ],
          } as any,
          [
            {
              name: 'Second Service',
              startTime: '2025-06-01T08:00:00.000Z',
              endTime: '2025-06-01T10:00:00.000Z',
            },
          ],
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
