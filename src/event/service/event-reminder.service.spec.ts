import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { EventReminderService } from './event-reminder.service';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { EventReminder } from '../entity/event-reminder.entity';
import { ServiceSlot } from '../entity/service-slot.entity';
import { Member } from '../../member/entity/member.entity';
import { Announcement } from '../../announcement/entity/announcement.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { CacheService } from '../../utility/service/cache.service';
import {
  PRESET_MINUTES,
  ReminderIntervalPresetEnum,
} from '../enum/reminder-interval-preset.enum';
import { AnnouncementAudienceEnum } from '../../announcement/enum/announcement-audience.enum';

const SLOT_START = new Date('2026-07-01T09:00:00.000Z');

const makeSlot = (overrides: Partial<ServiceSlot> = {}): ServiceSlot =>
  ({
    id: 'slot-1',
    startTime: SLOT_START,
    name: 'Morning Service',
    ...overrides,
  }) as ServiceSlot;

const makeReminder = (overrides: Partial<EventReminder> = {}): EventReminder =>
  ({
    id: 'reminder-1',
    intervalPreset: ReminderIntervalPresetEnum.HOUR_1,
    enabled: true,
    lastSentAt: null,
    fireAt: new Date(SLOT_START.getTime() - 60 * 60_000),
    audience: AnnouncementAudienceEnum.ALL,
    department: null,
    serviceSlot: makeSlot(),
    ...overrides,
  }) as EventReminder;

const mockReminderQb = {
  innerJoinAndSelect: jest.fn().mockReturnThis(),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
};

const mockReminderRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue(mockReminderQb),
};

const mockSlotRepo = {
  findOne: jest.fn(),
};

const mockMemberRepo = {
  createQueryBuilder: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  }),
};

const mockAnnouncementRepo = {
  create: jest.fn().mockReturnValue({}),
  save: jest.fn().mockResolvedValue({}),
};

const mockUtilityService = {
  sendEmailWithTemplate: jest.fn(),
};

const mockCacheService = {
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn(),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue('en-NG'),
};

describe('EventReminderService', () => {
  let service: EventReminderService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.acquireLock.mockResolvedValue(true);
    mockReminderRepo.createQueryBuilder.mockReturnValue(mockReminderQb);
    mockReminderQb.getMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventReminderService,
        {
          provide: getRepositoryToken(EventReminder),
          useValue: mockReminderRepo,
        },
        { provide: getRepositoryToken(ServiceSlot), useValue: mockSlotRepo },
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        {
          provide: getRepositoryToken(Announcement),
          useValue: mockAnnouncementRepo,
        },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: PushNotificationService,
          useValue: { dispatchToMemberIds: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<EventReminderService>(EventReminderService);
  });

  describe('create', () => {
    it('throws NotFoundException when slot does not exist', async () => {
      mockSlotRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create('missing-slot', {
          intervalPreset: ReminderIntervalPresetEnum.HOUR_1,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for DEPARTMENT audience without departmentId', async () => {
      mockSlotRepo.findOne.mockResolvedValue(makeSlot());

      await expect(
        service.create('slot-1', {
          intervalPreset: ReminderIntervalPresetEnum.HOUR_1,
          audience: AnnouncementAudienceEnum.DEPARTMENT,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for INDIVIDUAL audience', async () => {
      mockSlotRepo.findOne.mockResolvedValue(makeSlot());

      await expect(
        service.create('slot-1', {
          intervalPreset: ReminderIntervalPresetEnum.HOUR_1,
          audience: AnnouncementAudienceEnum.INDIVIDUAL,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets fireAt to slot.startTime minus preset minutes', async () => {
      const slot = makeSlot();
      mockSlotRepo.findOne.mockResolvedValue(slot);
      mockReminderRepo.create.mockReturnValue({});
      mockReminderRepo.save.mockResolvedValue({ id: 'new-reminder' });

      await service.create('slot-1', {
        intervalPreset: ReminderIntervalPresetEnum.HOURS_48,
      });

      const createArg = mockReminderRepo.create.mock.calls[0][0];
      const expectedFireAt = new Date(
        SLOT_START.getTime() -
          PRESET_MINUTES[ReminderIntervalPresetEnum.HOURS_48] * 60_000,
      );
      expect(createArg.fireAt).toEqual(expectedFireAt);
    });

    it('sets fireAt correctly for 15-minute preset', async () => {
      const slot = makeSlot();
      mockSlotRepo.findOne.mockResolvedValue(slot);
      mockReminderRepo.create.mockReturnValue({});
      mockReminderRepo.save.mockResolvedValue({ id: 'new-reminder' });

      await service.create('slot-1', {
        intervalPreset: ReminderIntervalPresetEnum.MIN_15,
      });

      const createArg = mockReminderRepo.create.mock.calls[0][0];
      const expectedFireAt = new Date(SLOT_START.getTime() - 15 * 60_000);
      expect(createArg.fireAt).toEqual(expectedFireAt);
    });
  });

  describe('update', () => {
    it('recalculates fireAt when intervalPreset changes', async () => {
      const reminder = makeReminder({
        intervalPreset: ReminderIntervalPresetEnum.HOUR_1,
      });
      mockReminderRepo.findOne.mockResolvedValue(reminder);
      mockReminderRepo.save.mockResolvedValue(reminder);

      await service.update('reminder-1', {
        intervalPreset: ReminderIntervalPresetEnum.HOURS_24,
      });

      const savedReminder = mockReminderRepo.save.mock.calls[0][0];
      const expectedFireAt = new Date(
        SLOT_START.getTime() -
          PRESET_MINUTES[ReminderIntervalPresetEnum.HOURS_24] * 60_000,
      );
      expect(savedReminder.fireAt).toEqual(expectedFireAt);
      expect(savedReminder.intervalPreset).toBe(
        ReminderIntervalPresetEnum.HOURS_24,
      );
    });

    it('does not modify fireAt when intervalPreset is not in the dto', async () => {
      const originalFireAt = new Date(SLOT_START.getTime() - 60 * 60_000);
      const reminder = makeReminder({ fireAt: originalFireAt });
      mockReminderRepo.findOne.mockResolvedValue(reminder);
      mockReminderRepo.save.mockResolvedValue(reminder);

      await service.update('reminder-1', { enabled: false });

      const savedReminder = mockReminderRepo.save.mock.calls[0][0];
      expect(savedReminder.fireAt).toEqual(originalFireAt);
    });
  });

  describe('dispatchDueReminders', () => {
    it('skips dispatch when another instance holds the lock', async () => {
      mockCacheService.acquireLock.mockResolvedValue(false);

      await service.dispatchDueReminders();

      expect(mockReminderQb.getMany).not.toHaveBeenCalled();
    });

    it('filters due reminders in SQL using fireAt and releases the lock', async () => {
      mockReminderQb.getMany.mockResolvedValue([]);

      await service.dispatchDueReminders();

      expect(mockReminderQb.andWhere).toHaveBeenCalledWith(
        'r.fireAt <= :now',
        expect.objectContaining({ now: expect.any(Date) }),
      );
      expect(mockReminderQb.andWhere).toHaveBeenCalledWith(
        'slot.startTime > :now',
        expect.objectContaining({ now: expect.any(Date) }),
      );
      expect(mockCacheService.releaseLock).toHaveBeenCalled();
    });

    it('calls fireReminder for each due reminder returned by SQL', async () => {
      const reminder = makeReminder();
      mockReminderQb.getMany.mockResolvedValue([reminder]);
      mockMemberRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ email: 'member@test.com' }]),
      });

      await service.dispatchDueReminders();

      expect(mockAnnouncementRepo.save).toHaveBeenCalled();
      expect(mockReminderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ lastSentAt: expect.any(Date) }),
      );
    });

    it('releases the lock even when no reminders are due', async () => {
      mockReminderQb.getMany.mockResolvedValue([]);

      await service.dispatchDueReminders();

      expect(mockCacheService.releaseLock).toHaveBeenCalledWith(
        'lock:dispatch-reminders',
      );
    });
  });
});
