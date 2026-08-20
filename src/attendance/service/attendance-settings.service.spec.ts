import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AttendanceSettingsService } from './attendance-settings.service';
import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';

const mockSettingRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const mockCacheService = {
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
};

const mockAuditLogService = { log: jest.fn() };

const mockPlatformSettingsService = {
  getEnforceDistanceCheckDefault: jest.fn().mockResolvedValue(false),
};

describe('AttendanceSettingsService', () => {
  let service: AttendanceSettingsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.get.mockResolvedValue(undefined);
    mockPlatformSettingsService.getEnforceDistanceCheckDefault.mockResolvedValue(
      false,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceSettingsService,
        {
          provide: getRepositoryToken(ChurchSetting),
          useValue: mockSettingRepo,
        },
        { provide: CacheService, useValue: mockCacheService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        {
          provide: PlatformSettingsService,
          useValue: mockPlatformSettingsService,
        },
      ],
    }).compile();

    service = module.get<AttendanceSettingsService>(AttendanceSettingsService);
  });

  describe('getConfig', () => {
    it('falls back to the platform default when the tenant has no override', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);
      mockPlatformSettingsService.getEnforceDistanceCheckDefault.mockResolvedValue(
        true,
      );

      const result = await service.getConfig();

      expect(result).toEqual({ enabled: true, isPlatformDefault: true });
    });

    it('returns the tenant override when one exists', async () => {
      mockSettingRepo.findOne.mockResolvedValue({
        key: 'attendance:enforce_distance_check',
        value: { enabled: false },
      });
      mockPlatformSettingsService.getEnforceDistanceCheckDefault.mockResolvedValue(
        true,
      );

      const result = await service.getConfig();

      expect(result).toEqual({ enabled: false, isPlatformDefault: false });
    });
  });

  describe('isEnabled', () => {
    it('returns the cached value without hitting the DB', async () => {
      mockCacheService.get.mockResolvedValue(true);

      const result = await service.isEnabled();

      expect(result).toBe(true);
      expect(mockSettingRepo.findOne).not.toHaveBeenCalled();
    });

    it('reads through getConfig and caches the result on a miss', async () => {
      mockSettingRepo.findOne.mockResolvedValue({
        key: 'attendance:enforce_distance_check',
        value: { enabled: true },
      });

      const result = await service.isEnabled();

      expect(result).toBe(true);
      expect(mockCacheService.set).toHaveBeenCalledWith(
        'attendance-settings:enforce-distance-check',
        true,
        300,
      );
    });
  });

  describe('setEnabled', () => {
    it('creates a new row when none exists', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);
      mockSettingRepo.create.mockImplementation((v) => v);
      mockSettingRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.setEnabled(true, 'member-1');

      expect(mockSettingRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'attendance:enforce_distance_check',
          value: { enabled: true },
        }),
      );
      expect(result).toEqual({ enabled: true, isPlatformDefault: false });
    });

    it('updates an existing row in place', async () => {
      const existing = {
        key: 'attendance:enforce_distance_check',
        value: { enabled: true },
      };
      mockSettingRepo.findOne.mockResolvedValue(existing);
      mockSettingRepo.save.mockImplementation((v) => Promise.resolve(v));

      await service.setEnabled(false, 'member-1');

      expect(mockSettingRepo.create).not.toHaveBeenCalled();
      expect(existing.value).toEqual({ enabled: false });
    });

    it('invalidates the cache and writes an audit log entry', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);
      mockSettingRepo.create.mockReturnValue({});
      mockSettingRepo.save.mockResolvedValue({});

      await service.setEnabled(true, 'member-1');

      expect(mockCacheService.del).toHaveBeenCalledWith(
        'attendance-settings:enforce-distance-check',
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'ATTENDANCE_DISTANCE_CHECK_SETTING_UPDATED',
        expect.objectContaining({
          actorId: 'member-1',
          metadata: { enabled: true },
        }),
      );
    });
  });
});
