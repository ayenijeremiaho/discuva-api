import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ReminderSettingsService } from './reminder-settings.service';
import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';
import { ReminderSettingKey } from '../enum/reminder-setting-key.enum';
import { KNOWN_REMINDER_SETTINGS } from '../constant/known-reminder-settings.constant';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

const mockSettingRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const mockCacheService = {
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
};

const mockAuditLogService = {
  log: jest.fn(),
};

describe('ReminderSettingsService', () => {
  let service: ReminderSettingsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.get.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReminderSettingsService,
        {
          provide: getRepositoryToken(ChurchSetting),
          useValue: mockSettingRepo,
        },
        { provide: CacheService, useValue: mockCacheService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<ReminderSettingsService>(ReminderSettingsService);
  });

  describe('findAll', () => {
    it('returns every known key with default thresholds when table is empty', async () => {
      mockSettingRepo.find.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toHaveLength(Object.values(ReminderSettingKey).length);
      expect(
        result.find((r) => r.key === ReminderSettingKey.PLEDGE_REMINDER),
      ).toMatchObject({
        enabled: true,
        thresholds:
          KNOWN_REMINDER_SETTINGS[ReminderSettingKey.PLEDGE_REMINDER]
            .defaultThresholds,
      });
    });

    it('merges DB overrides on top of defaults', async () => {
      mockSettingRepo.find.mockResolvedValue([
        {
          key: 'reminder:pledge_reminder',
          value: { enabled: false, thresholds: [10] },
        },
      ]);

      const result = await service.findAll();

      expect(
        result.find((r) => r.key === ReminderSettingKey.PLEDGE_REMINDER),
      ).toMatchObject({ enabled: false, thresholds: [10] });
      expect(
        result.find((r) => r.key === ReminderSettingKey.FOLLOW_UP_STALE),
      ).toMatchObject({ enabled: true });
    });
  });

  describe('findOne', () => {
    it('returns the default when no DB row exists', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);

      const result = await service.findOne(ReminderSettingKey.BUDGET_ALERT);

      expect(result.enabled).toBe(true);
      expect(result.thresholds).toEqual([80, 100]);
    });

    it('returns the DB value when a row exists', async () => {
      mockSettingRepo.findOne.mockResolvedValue({
        key: 'reminder:budget_alert',
        value: { enabled: true, thresholds: [50] },
      });

      const result = await service.findOne(ReminderSettingKey.BUDGET_ALERT);

      expect(result.thresholds).toEqual([50]);
    });

    it('throws NotFoundException for an unknown key', async () => {
      await expect(
        service.findOne('not_a_real_key' as ReminderSettingKey),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('upsert', () => {
    it('creates a new row when none exists', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);
      mockSettingRepo.create.mockImplementation((v) => v);
      mockSettingRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.upsert(ReminderSettingKey.FOLLOW_UP_STALE, {
        enabled: true,
        thresholds: [14],
        smsEnabled: false,
      });

      expect(mockSettingRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'reminder:follow_up_stale',
          value: { enabled: true, thresholds: [14], smsEnabled: false },
        }),
      );
      expect(result.thresholds).toEqual([14]);
    });

    it('updates an existing row in place', async () => {
      const existing = {
        key: 'reminder:follow_up_stale',
        value: { enabled: true, thresholds: [7], smsEnabled: false },
      };
      mockSettingRepo.findOne.mockResolvedValue(existing);
      mockSettingRepo.save.mockImplementation((v) => Promise.resolve(v));

      await service.upsert(ReminderSettingKey.FOLLOW_UP_STALE, {
        enabled: false,
        thresholds: [14],
        smsEnabled: true,
      });

      expect(mockSettingRepo.create).not.toHaveBeenCalled();
      expect(existing.value).toEqual({
        enabled: false,
        thresholds: [14],
        smsEnabled: true,
      });
    });

    it('invalidates the cache after upsert', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);
      mockSettingRepo.create.mockReturnValue({});
      mockSettingRepo.save.mockResolvedValue({});

      await service.upsert(ReminderSettingKey.PLEDGE_REMINDER, {
        enabled: true,
        thresholds: [7],
        smsEnabled: false,
      });

      expect(mockCacheService.del).toHaveBeenCalledWith(
        'reminder-settings:pledge_reminder',
      );
    });

    it('writes an audit log entry', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);
      mockSettingRepo.create.mockReturnValue({});
      mockSettingRepo.save.mockResolvedValue({});

      await service.upsert(ReminderSettingKey.PLEDGE_REMINDER, {
        enabled: true,
        thresholds: [7],
        smsEnabled: false,
      });

      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'REMINDER_SETTING_UPDATED',
        expect.objectContaining({
          targetId: ReminderSettingKey.PLEDGE_REMINDER,
        }),
      );
    });

    it('throws NotFoundException for an unknown key', async () => {
      await expect(
        service.upsert('not_a_real_key' as ReminderSettingKey, {
          enabled: true,
          thresholds: [],
          smsEnabled: false,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getConfig', () => {
    it('returns the cached value without hitting the DB', async () => {
      mockCacheService.get.mockResolvedValue({
        enabled: false,
        thresholds: [3],
        smsEnabled: true,
      });

      const result = await service.getConfig(ReminderSettingKey.ASSET_WARRANTY);

      expect(result).toEqual({
        enabled: false,
        thresholds: [3],
        smsEnabled: true,
      });
      expect(mockSettingRepo.findOne).not.toHaveBeenCalled();
    });

    it('falls back to the default (smsEnabled off) when no cache or DB row exists', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);

      const result = await service.getConfig(ReminderSettingKey.ASSET_WARRANTY);

      expect(result).toEqual({
        enabled: true,
        thresholds:
          KNOWN_REMINDER_SETTINGS[ReminderSettingKey.ASSET_WARRANTY]
            .defaultThresholds,
        smsEnabled: false,
      });
    });

    it('reads the DB value and caches it on a miss', async () => {
      mockSettingRepo.findOne.mockResolvedValue({
        key: 'reminder:asset_warranty',
        value: { enabled: true, thresholds: [20], smsEnabled: true },
      });

      const result = await service.getConfig(ReminderSettingKey.ASSET_WARRANTY);

      expect(result).toEqual({
        enabled: true,
        thresholds: [20],
        smsEnabled: true,
      });
      expect(mockCacheService.set).toHaveBeenCalledWith(
        'reminder-settings:asset_warranty',
        { enabled: true, thresholds: [20], smsEnabled: true },
        300,
      );
    });

    it('defaults smsEnabled to false when a DB row exists without it', async () => {
      mockSettingRepo.findOne.mockResolvedValue({
        key: 'reminder:asset_warranty',
        value: { enabled: true, thresholds: [20] },
      });

      const result = await service.getConfig(ReminderSettingKey.ASSET_WARRANTY);

      expect(result.smsEnabled).toBe(false);
    });
  });
});
