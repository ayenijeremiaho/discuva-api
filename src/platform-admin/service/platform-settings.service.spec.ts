import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PlatformSettingsService } from './platform-settings.service';
import { PlatformSetting } from '../entity/platform-setting.entity';
import { PlatformSettingKey } from '../enum/platform-setting-key.enum';
import { CacheService } from '../../utility/service/cache.service';

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

describe('PlatformSettingsService', () => {
  let service: PlatformSettingsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.get.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformSettingsService,
        {
          provide: getRepositoryToken(PlatformSetting),
          useValue: mockSettingRepo,
        },
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    service = module.get<PlatformSettingsService>(PlatformSettingsService);
  });

  describe('findAll', () => {
    it('returns the default value when the table is empty', async () => {
      mockSettingRepo.find.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual(
        expect.arrayContaining([
          {
            key: PlatformSettingKey.SUBSCRIPTION_GRACE_PERIOD_DAYS,
            label: 'Subscription Grace Period',
            unit: 'days after payment lapse before downgrade to Free',
            value: 7,
            min: 0,
            max: 365,
          },
        ]),
      );
    });

    it('merges a DB override', async () => {
      mockSettingRepo.find.mockResolvedValue([
        {
          key: PlatformSettingKey.SUBSCRIPTION_GRACE_PERIOD_DAYS,
          value: { value: 14 },
        },
      ]);

      const result = await service.findAll();

      expect(result[0].value).toBe(14);
    });
  });

  describe('upsert', () => {
    it('creates a new row when none exists', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);
      mockSettingRepo.create.mockImplementation((v) => v);
      mockSettingRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.upsert(
        PlatformSettingKey.SUBSCRIPTION_GRACE_PERIOD_DAYS,
        { value: 10 },
      );

      expect(mockSettingRepo.create).toHaveBeenCalledWith({
        key: PlatformSettingKey.SUBSCRIPTION_GRACE_PERIOD_DAYS,
        value: { value: 10 },
      });
      expect(result.value).toBe(10);
    });

    it('invalidates the cache after upsert', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);
      mockSettingRepo.create.mockReturnValue({});
      mockSettingRepo.save.mockResolvedValue({});

      await service.upsert(PlatformSettingKey.SUBSCRIPTION_GRACE_PERIOD_DAYS, {
        value: 10,
      });

      expect(mockCacheService.del).toHaveBeenCalledWith(
        'platform-settings:subscription_grace_period_days',
      );
    });

    it('throws NotFoundException for an unknown key', async () => {
      await expect(
        service.upsert('not_a_real_key' as PlatformSettingKey, { value: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a value outside the known min/max for that key', async () => {
      await expect(
        service.upsert(PlatformSettingKey.MAX_LOGO_UPLOAD_MB, { value: 100 }),
      ).rejects.toThrow(BadRequestException);
      expect(mockSettingRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getSubscriptionGracePeriodDays', () => {
    it('returns the cached value without hitting the DB', async () => {
      mockCacheService.get.mockResolvedValue(21);

      const result = await service.getSubscriptionGracePeriodDays();

      expect(result).toBe(21);
      expect(mockSettingRepo.findOne).not.toHaveBeenCalled();
    });

    it('falls back to the default when no cache or DB row exists', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);

      const result = await service.getSubscriptionGracePeriodDays();

      expect(result).toBe(7);
    });

    it('reads the DB value and caches it on a miss', async () => {
      mockSettingRepo.findOne.mockResolvedValue({
        key: PlatformSettingKey.SUBSCRIPTION_GRACE_PERIOD_DAYS,
        value: { value: 5 },
      });

      const result = await service.getSubscriptionGracePeriodDays();

      expect(result).toBe(5);
      expect(mockCacheService.set).toHaveBeenCalledWith(
        'platform-settings:subscription_grace_period_days',
        5,
        300,
      );
    });
  });
});
