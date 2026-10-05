import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EvangelismSettingsService } from './evangelism-settings.service';
import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

const mockSettingRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};
const mockCacheService = {
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
  key: jest.fn().mockReturnValue('cache-key'),
};
const mockAuditLogService = { log: jest.fn() };

describe('EvangelismSettingsService', () => {
  let service: EvangelismSettingsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.get.mockResolvedValue(undefined);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvangelismSettingsService,
        {
          provide: getRepositoryToken(ChurchSetting),
          useValue: mockSettingRepo,
        },
        { provide: CacheService, useValue: mockCacheService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();
    service = module.get(EvangelismSettingsService);
  });

  it('returns defaults when nothing is stored', async () => {
    mockSettingRepo.findOne.mockResolvedValue(null);

    expect(await service.get()).toEqual({ overdueDays: 7, autoAssign: true });
    expect(mockCacheService.set).toHaveBeenCalled();
  });

  it('serves from cache', async () => {
    mockCacheService.get.mockResolvedValue({
      overdueDays: 3,
      autoAssign: false,
    });

    expect(await service.get()).toEqual({ overdueDays: 3, autoAssign: false });
    expect(mockSettingRepo.findOne).not.toHaveBeenCalled();
  });

  it('merges a partial update, saves, clears the cache and audit-logs', async () => {
    mockSettingRepo.findOne.mockResolvedValue(null);
    mockSettingRepo.create.mockImplementation((r) => r);

    const result = await service.update({ overdueDays: 10 }, 'admin-m');

    expect(result).toEqual({ overdueDays: 10, autoAssign: true });
    expect(mockSettingRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'evangelism:settings',
        value: { overdueDays: 10, autoAssign: true },
      }),
    );
    expect(mockCacheService.del).toHaveBeenCalledWith('evangelism-settings');
    expect(mockAuditLogService.log).toHaveBeenCalledWith(
      'EVANGELISM_SETTINGS_UPDATED',
      expect.objectContaining({ actorId: 'admin-m' }),
    );
  });
});
