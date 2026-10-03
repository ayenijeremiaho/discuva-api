/// <reference types="jest" />

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { TenantProfileService } from './tenant-profile.service';
import { Tenant } from '../entity/tenant.entity';
import { ChurchThemePreset } from '../enum/church-theme-preset.enum';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

const mockTenantRepository = { findOneBy: jest.fn(), save: jest.fn() };
const mockCls = { get: jest.fn() };
const mockCacheService = {
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
  key: jest.fn().mockReturnValue('cache-key'),
};
const mockAuditLogService = { log: jest.fn() };
const actor = { adminId: 'admin-1', memberId: 'member-1' };
const baseTenant = {
  id: 'tenant-1',
  name: 'Your church',
  themePreset: ChurchThemePreset.CLASSIC,
  previousThemePreset: null,
  tagline: null,
};

describe('TenantProfileService', () => {
  let service: TenantProfileService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCls.get.mockReturnValue('tenant-1');
    mockTenantRepository.findOneBy.mockResolvedValue({ ...baseTenant });
    mockTenantRepository.save.mockImplementation(async (tenant) => tenant);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantProfileService,
        { provide: ClsService, useValue: mockCls },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepository },
        { provide: CacheService, useValue: mockCacheService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();
    service = module.get(TenantProfileService);
  });

  it('resolves the tenant from request context using its ID', async () => {
    await expect(service.getCurrentTenant()).resolves.toEqual(baseTenant);
    expect(mockCls.get).toHaveBeenCalledWith('tenantId');
    expect(mockTenantRepository.findOneBy).toHaveBeenCalledWith({
      id: 'tenant-1',
    });
  });

  it('rejects a missing tenant context without querying the repository', async () => {
    mockCls.get.mockReturnValue(undefined);
    await expect(
      service.updateProfile({ themePreset: ChurchThemePreset.OCEAN }, actor),
    ).rejects.toThrow(NotFoundException);
    expect(mockTenantRepository.findOneBy).not.toHaveBeenCalled();
    expect(mockTenantRepository.save).not.toHaveBeenCalled();
    expect(mockAuditLogService.log).not.toHaveBeenCalled();
  });

  it('rejects a tenant that no longer exists', async () => {
    mockTenantRepository.findOneBy.mockResolvedValue(null);
    await expect(service.getCurrentTenant()).rejects.toThrow(NotFoundException);
  });

  it('owns profile persistence, cache invalidation, and palette auditing', async () => {
    const result = await service.updateProfile(
      { themePreset: ChurchThemePreset.OCEAN },
      actor,
    );

    expect(result.themePreset).toBe(ChurchThemePreset.OCEAN);
    expect(result.previousThemePreset).toBe(ChurchThemePreset.CLASSIC);
    expect(mockTenantRepository.save).toHaveBeenCalledWith(result);
    expect(mockCacheService.del).toHaveBeenCalledWith(
      'tenant-branding:tenant-1',
    );
    expect(mockAuditLogService.log).toHaveBeenCalledTimes(1);
    expect(mockAuditLogService.log).toHaveBeenCalledWith(
      'CHURCH_THEME_CHANGED',
      {
        actorId: 'member-1',
        targetId: 'tenant-1',
        targetName: 'Your church',
        metadata: {
          adminId: 'admin-1',
          previousThemePreset: ChurchThemePreset.CLASSIC,
          themePreset: ChurchThemePreset.OCEAN,
        },
      },
    );
  });

  it('preserves revert behavior and audits its before/after values', async () => {
    mockTenantRepository.findOneBy.mockResolvedValue({
      ...baseTenant,
      themePreset: ChurchThemePreset.OCEAN,
      previousThemePreset: ChurchThemePreset.CLASSIC,
    });
    const result = await service.updateProfile(
      { themePreset: ChurchThemePreset.CLASSIC },
      actor,
    );
    expect(result.previousThemePreset).toBe(ChurchThemePreset.OCEAN);
    expect(mockAuditLogService.log).toHaveBeenCalledWith(
      'CHURCH_THEME_CHANGED',
      expect.objectContaining({
        metadata: {
          adminId: 'admin-1',
          previousThemePreset: ChurchThemePreset.OCEAN,
          themePreset: ChurchThemePreset.CLASSIC,
        },
      }),
    );
  });

  it('does not audit an unchanged palette or replace the previous preset', async () => {
    mockTenantRepository.findOneBy.mockResolvedValue({
      ...baseTenant,
      previousThemePreset: ChurchThemePreset.OCEAN,
    });
    const result = await service.updateProfile(
      { themePreset: ChurchThemePreset.CLASSIC },
      actor,
    );
    expect(result.previousThemePreset).toBe(ChurchThemePreset.OCEAN);
    expect(mockAuditLogService.log).not.toHaveBeenCalled();
  });

  it('persists unrelated profile fields without a palette audit event', async () => {
    const result = await service.updateProfile(
      { tagline: 'Welcome to your congregation' },
      actor,
    );
    expect(result.tagline).toBe('Welcome to your congregation');
    expect(result.themePreset).toBe(ChurchThemePreset.CLASSIC);
    expect(mockTenantRepository.save).toHaveBeenCalled();
    expect(mockAuditLogService.log).not.toHaveBeenCalled();
  });

  it('does not invalidate cache or audit a failed save', async () => {
    mockTenantRepository.save.mockRejectedValueOnce(new Error('Save failed'));
    await expect(
      service.updateProfile({ themePreset: ChurchThemePreset.OCEAN }, actor),
    ).rejects.toThrow('Save failed');
    expect(mockCacheService.del).not.toHaveBeenCalled();
    expect(mockAuditLogService.log).not.toHaveBeenCalled();
  });
});
