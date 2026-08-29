import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  getGlobal: jest.fn().mockResolvedValue(undefined),
  setGlobal: jest.fn().mockResolvedValue(undefined),
  delGlobal: jest.fn().mockResolvedValue(1),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue(false),
};

describe('PlatformSettingsService', () => {
  let service: PlatformSettingsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.getGlobal.mockResolvedValue(undefined);
    mockConfigService.get.mockReturnValue(false);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformSettingsService,
        {
          provide: getRepositoryToken(PlatformSetting),
          useValue: mockSettingRepo,
        },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ConfigService, useValue: mockConfigService },
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
            type: 'number',
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

      expect(mockCacheService.delGlobal).toHaveBeenCalledWith(
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
      mockCacheService.getGlobal.mockResolvedValue(21);

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
      expect(mockCacheService.setGlobal).toHaveBeenCalledWith(
        'platform-settings:subscription_grace_period_days',
        5,
        300,
      );
    });
  });

  // Regression coverage for the real bug this uncovered: CacheService's
  // plain get/set/del always namespace by the current tenant, but platform
  // settings aren't tenant-specific — a tenant-scoped upload request caching
  // its own copy under that tenant's id would never see a platform admin's
  // update (made with no tenant context) invalidate it. getGlobal/setGlobal/
  // delGlobal bypass that namespacing entirely; these tests just confirm
  // this service actually calls the *Global variants, not get/set/del.
  describe('getMaxUploadBytes', () => {
    it('returns the cached MB value converted to bytes, without hitting the DB', async () => {
      mockCacheService.getGlobal.mockResolvedValue(5);

      const result = await service.getMaxUploadBytes(
        PlatformSettingKey.MAX_LOGO_UPLOAD_MB,
      );

      expect(result).toBe(5 * 1024 * 1024);
      expect(mockSettingRepo.findOne).not.toHaveBeenCalled();
    });

    it('falls back to the default (in bytes) when no cache or DB row exists', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);

      const result = await service.getMaxUploadBytes(
        PlatformSettingKey.MAX_LOGO_UPLOAD_MB,
      );

      expect(result).toBe(5 * 1024 * 1024);
    });

    it('reads the DB value (MB) and caches it via the global, non-tenant-scoped cache', async () => {
      mockSettingRepo.findOne.mockResolvedValue({
        key: PlatformSettingKey.MAX_LOGO_UPLOAD_MB,
        value: { value: 8 },
      });

      const result = await service.getMaxUploadBytes(
        PlatformSettingKey.MAX_LOGO_UPLOAD_MB,
      );

      expect(result).toBe(8 * 1024 * 1024);
      expect(mockCacheService.setGlobal).toHaveBeenCalledWith(
        'platform-settings:max_logo_upload_mb',
        8,
        300,
      );
    });
  });

  // ENFORCE_DISTANCE_CHECK_DEFAULT is the one setting whose "no row yet"
  // fallback reads the live ENFORCE_DISTANCE_CHECK env var instead of a
  // hardcoded KNOWN_PLATFORM_SETTINGS default — see resolveDefault()'s
  // comment for why (an already-deployed env var shouldn't be silently
  // overridden by shipping this feature).
  describe('getEnforceDistanceCheckDefault', () => {
    it('returns the cached value without hitting the DB', async () => {
      mockCacheService.getGlobal.mockResolvedValue(1);

      const result = await service.getEnforceDistanceCheckDefault();

      expect(result).toBe(true);
      expect(mockSettingRepo.findOne).not.toHaveBeenCalled();
    });

    it('falls back to the live env var when no cache or DB row exists', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);
      mockConfigService.get.mockReturnValue(true);

      const result = await service.getEnforceDistanceCheckDefault();

      expect(result).toBe(true);
      expect(mockConfigService.get).toHaveBeenCalledWith(
        'ENFORCE_DISTANCE_CHECK',
      );
    });

    it('prefers a DB row over the env var once a platform admin has set one', async () => {
      mockSettingRepo.findOne.mockResolvedValue({
        key: PlatformSettingKey.ENFORCE_DISTANCE_CHECK_DEFAULT,
        value: { value: 0 },
      });
      mockConfigService.get.mockReturnValue(true);

      const result = await service.getEnforceDistanceCheckDefault();

      expect(result).toBe(false);
    });
  });

  describe('getSocialMediaEnabled', () => {
    it('returns the cached value without hitting the DB', async () => {
      mockCacheService.getGlobal.mockResolvedValue(1);

      const result = await service.getSocialMediaEnabled();

      expect(result).toBe(true);
      expect(mockSettingRepo.findOne).not.toHaveBeenCalled();
    });

    it('defaults to disabled when no cache or DB row exists', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);

      const result = await service.getSocialMediaEnabled();

      expect(result).toBe(false);
    });

    it('reads the DB value once a platform admin has flipped it on', async () => {
      mockSettingRepo.findOne.mockResolvedValue({
        key: PlatformSettingKey.SOCIAL_MEDIA_ENABLED,
        value: { value: 1 },
      });

      const result = await service.getSocialMediaEnabled();

      expect(result).toBe(true);
      expect(mockCacheService.setGlobal).toHaveBeenCalledWith(
        'platform-settings:social_media_enabled',
        1,
        300,
      );
    });
  });

  describe('findOne', () => {
    it('reports type: "boolean" for a boolean-shaped setting', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);
      mockConfigService.get.mockReturnValue(false);

      const result = await service.findOne(
        PlatformSettingKey.ENFORCE_DISTANCE_CHECK_DEFAULT,
      );

      expect(result.type).toBe('boolean');
      expect(result.value).toBe(0);
    });

    it('reflects the live env var as the default value shown in the UI', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);
      mockConfigService.get.mockReturnValue(true);

      const result = await service.findOne(
        PlatformSettingKey.ENFORCE_DISTANCE_CHECK_DEFAULT,
      );

      expect(result.value).toBe(1);
    });
  });
});
