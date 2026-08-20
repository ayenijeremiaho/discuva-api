import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { EmailCategorySettingsService } from './email-category-settings.service';
import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { KNOWN_EMAIL_CATEGORIES } from '../constant/known-email-categories.constant';
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

describe('EmailCategorySettingsService', () => {
  let service: EmailCategorySettingsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.get.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailCategorySettingsService,
        {
          provide: getRepositoryToken(ChurchSetting),
          useValue: mockSettingRepo,
        },
        { provide: CacheService, useValue: mockCacheService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<EmailCategorySettingsService>(
      EmailCategorySettingsService,
    );
  });

  describe('findAll', () => {
    it('returns every known category enabled by default when the table is empty', async () => {
      mockSettingRepo.find.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toHaveLength(Object.values(EmailCategory).length);
      expect(
        result.find((r) => r.category === EmailCategory.BIRTHDAY),
      ).toMatchObject({
        enabled: true,
        label: KNOWN_EMAIL_CATEGORIES[EmailCategory.BIRTHDAY].label,
      });
    });

    it('merges a DB override on top of the default', async () => {
      mockSettingRepo.find.mockResolvedValue([
        { key: 'email_category:BIRTHDAY', value: { enabled: false } },
      ]);

      const result = await service.findAll();

      expect(
        result.find((r) => r.category === EmailCategory.BIRTHDAY),
      ).toMatchObject({ enabled: false });
      expect(
        result.find((r) => r.category === EmailCategory.LOGIN_ALERT),
      ).toMatchObject({ enabled: true });
    });
  });

  describe('findOne', () => {
    it('returns enabled: true when no DB row exists', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);

      const result = await service.findOne(EmailCategory.GIVING_RECEIPT);

      expect(result.enabled).toBe(true);
    });

    it('returns the DB value when a row exists', async () => {
      mockSettingRepo.findOne.mockResolvedValue({
        key: 'email_category:GIVING_RECEIPT',
        value: { enabled: false },
      });

      const result = await service.findOne(EmailCategory.GIVING_RECEIPT);

      expect(result.enabled).toBe(false);
    });

    it('throws NotFoundException for an unknown category', async () => {
      await expect(
        service.findOne('NOT_A_REAL_CATEGORY' as EmailCategory),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('upsert', () => {
    it('creates a new row when none exists', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);
      mockSettingRepo.create.mockImplementation((v) => v);
      mockSettingRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.upsert(EmailCategory.INCIDENT_REPORT, {
        enabled: false,
      });

      expect(mockSettingRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'email_category:INCIDENT_REPORT',
          value: { enabled: false },
        }),
      );
      expect(result.enabled).toBe(false);
    });

    it('updates an existing row in place', async () => {
      const existing = {
        key: 'email_category:INCIDENT_REPORT',
        value: { enabled: true },
      };
      mockSettingRepo.findOne.mockResolvedValue(existing);
      mockSettingRepo.save.mockImplementation((v) => Promise.resolve(v));

      await service.upsert(EmailCategory.INCIDENT_REPORT, { enabled: false });

      expect(mockSettingRepo.create).not.toHaveBeenCalled();
      expect(existing.value).toEqual({ enabled: false });
    });

    it('invalidates the cache after upsert', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);
      mockSettingRepo.create.mockReturnValue({});
      mockSettingRepo.save.mockResolvedValue({});

      await service.upsert(EmailCategory.BIRTHDAY, { enabled: false });

      expect(mockCacheService.del).toHaveBeenCalledWith(
        'email-category-settings:BIRTHDAY',
      );
    });

    it('writes an audit log entry', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);
      mockSettingRepo.create.mockReturnValue({});
      mockSettingRepo.save.mockResolvedValue({});

      await service.upsert(EmailCategory.BIRTHDAY, { enabled: false });

      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'EMAIL_CATEGORY_SETTING_UPDATED',
        expect.objectContaining({ targetId: EmailCategory.BIRTHDAY }),
      );
    });

    it('throws NotFoundException for an unknown category', async () => {
      await expect(
        service.upsert('NOT_A_REAL_CATEGORY' as EmailCategory, {
          enabled: true,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('isEnabled', () => {
    it('returns the cached value without hitting the DB', async () => {
      mockCacheService.get.mockResolvedValue(false);

      const result = await service.isEnabled(EmailCategory.LOGIN_ALERT);

      expect(result).toBe(false);
      expect(mockSettingRepo.findOne).not.toHaveBeenCalled();
    });

    it('defaults to enabled when there is no cache or DB row', async () => {
      mockSettingRepo.findOne.mockResolvedValue(null);

      const result = await service.isEnabled(EmailCategory.LOGIN_ALERT);

      expect(result).toBe(true);
    });

    it('reads the DB value and caches it on a miss', async () => {
      mockSettingRepo.findOne.mockResolvedValue({
        key: 'email_category:LOGIN_ALERT',
        value: { enabled: false },
      });

      const result = await service.isEnabled(EmailCategory.LOGIN_ALERT);

      expect(result).toBe(false);
      expect(mockCacheService.set).toHaveBeenCalledWith(
        'email-category-settings:LOGIN_ALERT',
        false,
        300,
      );
    });
  });
});
