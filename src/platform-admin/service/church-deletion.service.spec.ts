import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { ChurchDeletionService } from './church-deletion.service';
import { PlatformSettingsService } from './platform-settings.service';
import { PlatformAdminSecurityEvent } from '../entity/platform-admin-security-event.entity';
import { TenantDeletionService } from '../../tenant/service/tenant-deletion.service';
import { Tenant } from '../../tenant/entity/tenant.entity';

const tenant = (over: Partial<Tenant> = {}) =>
  ({
    id: 't1',
    subdomain: 'sampletest',
    schemaName: 'tenant_sampletest',
    isActive: false,
    parentTenantId: null,
    ...over,
  }) as Tenant;

describe('ChurchDeletionService', () => {
  let service: ChurchDeletionService;
  const query = jest.fn();
  const insert = jest.fn().mockResolvedValue(undefined);
  const tenantDeletion = { delete: jest.fn().mockResolvedValue(undefined) };
  const settings = { getNumber: jest.fn().mockResolvedValue(25) };
  let checks: { members: number; network: boolean; paid: boolean };

  beforeEach(async () => {
    jest.clearAllMocks();
    checks = { members: 3, network: false, paid: false };
    query.mockImplementation((sql: string) => {
      if (sql.includes('AS members')) return Promise.resolve([checks]);
      if (sql.startsWith('SELECT account_id')) {
        return Promise.resolve([{ account_id: 'a1' }, { account_id: 'a2' }]);
      }
      return Promise.resolve([]);
    });
    const module = await Test.createTestingModule({
      providers: [
        ChurchDeletionService,
        { provide: getDataSourceToken(), useValue: { query } },
        {
          provide: getRepositoryToken(PlatformAdminSecurityEvent),
          useValue: { insert },
        },
        { provide: TenantDeletionService, useValue: tenantDeletion },
        { provide: PlatformSettingsService, useValue: settings },
      ],
    }).compile();
    service = module.get(ChurchDeletionService);
  });

  it('deletes a suspended, small, free church and logs who did it', async () => {
    await service.delete(tenant(), 'admin-1');

    expect(tenantDeletion.delete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
    );
    expect(insert).toHaveBeenCalledWith({
      platformAdminId: 'admin-1',
      actorId: 'admin-1',
      action: 'deleted church sampletest',
    });
  });

  it('removes only the Discuva accounts left with no church', async () => {
    await service.delete(tenant(), 'admin-1');

    const [sql, params] = query.mock.calls.find(([s]) =>
      (s as string).startsWith('DELETE FROM public.discuva_accounts'),
    ) as [string, unknown[]];
    expect(sql).toContain('NOT EXISTS');
    expect(params).toEqual([['a1', 'a2']]);
  });

  it.each([
    ['still active', tenant({ isActive: true }), {}],
    ['part of a network', tenant(), { network: true }],
    ['on a paid plan', tenant(), { paid: true }],
    ['over the member limit', tenant(), { members: 26 }],
    ['an unsafe schema name', tenant({ schemaName: 'x"; DROP' }), {}],
  ])('refuses a church %s', async (_label, t, over) => {
    Object.assign(checks, over);

    await expect(service.delete(t, 'admin-1')).rejects.toThrow(
      ConflictException,
    );
    expect(tenantDeletion.delete).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('reads the member limit from the console setting', async () => {
    settings.getNumber.mockResolvedValueOnce(2);
    await expect(service.delete(tenant(), 'admin-1')).rejects.toThrow(
      'up to 2',
    );
  });
});
