import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChurchSettingsService } from './church-settings.service';
import { ChurchSetting } from '../entity/church-setting.entity';
import { KNOWN_MODULES } from '../constants/known-modules.constant';
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

describe('ChurchSettingsService', () => {
  let service: ChurchSettingsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.get.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChurchSettingsService,
        {
          provide: getRepositoryToken(ChurchSetting),
          useValue: mockSettingRepo,
        },
        { provide: CacheService, useValue: mockCacheService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<ChurchSettingsService>(ChurchSettingsService);
  });

  describe('findAll', () => {
    it('returns all known modules as enabled when table is empty', async () => {
      mockSettingRepo.find.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toHaveLength(KNOWN_MODULES.length);
      expect(result.every((r) => r.enabled === true)).toBe(true);
    });

    it('merges DB overrides — disabled module shows enabled:false', async () => {
      mockSettingRepo.find.mockResolvedValue([
        {
          key: 'incident_report',
          moduleName: 'Incident Report',
          value: { enabled: false },
        },
      ]);

      const result = await service.findAll();

      expect(result.find((r) => r.key === 'incident_report')?.enabled).toBe(
        false,
      );
      expect(result.find((r) => r.key === 'asset_management')?.enabled).toBe(
        true,
      );
    });

    it('surfaces a displayName override when present', async () => {
      mockSettingRepo.find.mockResolvedValue([
        {
          key: 'incident_report',
          moduleName: 'Incident Report',
          value: { enabled: true, displayName: 'Safety Reports' },
        },
      ]);

      const result = await service.findAll();

      expect(result.find((r) => r.key === 'incident_report')?.displayName).toBe(
        'Safety Reports',
      );
    });
  });

  describe('findOne', () => {
    it('returns enabled:true when no DB row exists', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);

      const result = await service.findOne('incident_report');

      expect(result.enabled).toBe(true);
      expect(result.key).toBe('incident_report');
    });

    it('returns DB value when row exists', async () => {
      mockSettingRepo.findOne.mockResolvedValue({
        key: 'incident_report',
        moduleName: 'Incident Report',
        value: { enabled: false },
      });

      const result = await service.findOne('incident_report');

      expect(result.enabled).toBe(false);
    });

    it('throws NotFoundException for unknown key', async () => {
      await expect(service.findOne('unknown_module')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('upsert', () => {
    it('creates a new row when none exists', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);
      const created = {
        key: 'incident_report',
        moduleName: 'Incident Report',
        value: { enabled: false },
      };
      mockSettingRepo.create.mockReturnValue(created);
      mockSettingRepo.save.mockResolvedValue(created);

      const result = await service.upsert('incident_report', {
        enabled: false,
      });

      expect(mockSettingRepo.create).toHaveBeenCalledWith({
        key: 'incident_report',
        moduleName: 'Incident Report',
        value: { enabled: false },
      });
      expect(result.enabled).toBe(false);
    });

    it('updates existing row when one exists', async () => {
      const existing = {
        key: 'incident_report',
        moduleName: 'Incident Report',
        value: { enabled: true },
      };
      mockSettingRepo.findOne.mockResolvedValue(existing);
      mockSettingRepo.save.mockResolvedValue({
        ...existing,
        value: { enabled: false },
      });

      const result = await service.upsert('incident_report', {
        enabled: false,
      });

      expect(mockSettingRepo.create).not.toHaveBeenCalled();
      expect(existing.value).toEqual({ enabled: false });
      expect(result.enabled).toBe(false);
    });

    it('invalidates cache after upsert', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);
      mockSettingRepo.create.mockReturnValue({});
      mockSettingRepo.save.mockResolvedValue({});

      await service.upsert('incident_report', { enabled: false });

      expect(mockCacheService.del).toHaveBeenCalledWith(
        'church-settings:module:incident_report',
      );
    });

    it('throws NotFoundException for unknown key', async () => {
      await expect(
        service.upsert('unknown_module', { enabled: false }),
      ).rejects.toThrow(NotFoundException);
    });

    it('stores a displayName override alongside enabled', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);
      mockSettingRepo.create.mockImplementation((v) => v);
      mockSettingRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.upsert('incident_report', {
        enabled: true,
        displayName: 'Safety Reports',
      });

      expect(mockSettingRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          value: { enabled: true, displayName: 'Safety Reports' },
        }),
      );
      expect(result.displayName).toBe('Safety Reports');
    });

    it('throws BadRequestException when disabling a required module', async () => {
      await expect(
        service.upsert('departments', { enabled: false }),
      ).rejects.toThrow(BadRequestException);
    });

    it('preserves an existing displayName when toggling enabled without passing displayName', async () => {
      mockSettingRepo.findOne.mockResolvedValue({
        key: 'incident_report',
        moduleName: 'Incident Report',
        value: { enabled: true, displayName: 'Safety Reports' },
      });
      mockSettingRepo.save.mockImplementation((r) => Promise.resolve(r));

      const result = await service.upsert('incident_report', {
        enabled: false,
      });

      expect(result.displayName).toBe('Safety Reports');
      expect(mockSettingRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          value: { enabled: false, displayName: 'Safety Reports' },
        }),
      );
    });
  });

  describe('isEnabled', () => {
    it('returns cached value without hitting DB', async () => {
      mockCacheService.get.mockResolvedValue({ enabled: false });

      const result = await service.isEnabled('incident_report');

      expect(result).toBe(false);
      expect(mockSettingRepo.findOne).not.toHaveBeenCalled();
    });

    it('defaults to true when no DB row exists', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);

      const result = await service.isEnabled('incident_report');

      expect(result).toBe(true);
    });

    it('returns DB value and caches it', async () => {
      mockSettingRepo.findOne.mockResolvedValue({
        key: 'incident_report',
        value: { enabled: false },
      });

      const result = await service.isEnabled('incident_report');

      expect(result).toBe(false);
      expect(mockCacheService.set).toHaveBeenCalledWith(
        'church-settings:module:incident_report',
        { enabled: false },
        300,
      );
    });
  });

  describe('getPublicModuleState', () => {
    it('falls back to moduleName when no displayName override is set', async () => {
      mockSettingRepo.find.mockResolvedValue([]);

      const result = await service.getPublicModuleState();

      const incidentReport = result.find((r) => r.key === 'incident_report');
      expect(incidentReport).toEqual({
        key: 'incident_report',
        enabled: true,
        displayName: 'Incident Report',
      });
    });

    it('uses the displayName override when set', async () => {
      mockSettingRepo.find.mockResolvedValue([
        {
          key: 'evangelism',
          moduleName: 'Evangelism',
          value: { enabled: false, displayName: 'Outreach' },
        },
      ]);

      const result = await service.getPublicModuleState();

      expect(result.find((r) => r.key === 'evangelism')).toEqual({
        key: 'evangelism',
        enabled: false,
        displayName: 'Outreach',
      });
    });
  });
});
