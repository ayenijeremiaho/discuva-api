import { NotFoundException } from '@nestjs/common';
import { TenantReportService } from './tenant-report.service';
import { PlatformAdminPermission } from '../../platform-admin/enum/platform-admin-permission.enum';

describe('TenantReportService', () => {
  const reportRepo = {
    save: jest.fn(),
    create: jest.fn((v) => v),
    update: jest.fn(),
  };
  const adminRepo = { find: jest.fn() };
  const utility = { sendEmailWithTemplate: jest.fn() };
  const service = new TenantReportService(
    reportRepo as never,
    adminRepo as never,
    utility as never,
    { get: jest.fn().mockReturnValue('https://console') } as never,
  );
  const admin = (email: string, permissions: string[]) => ({
    email,
    platformAdminRole: { permissions },
  });

  beforeEach(() => jest.clearAllMocks());

  it('saves the report and tells only staff who can act on it', async () => {
    adminRepo.find.mockResolvedValue([
      admin('can@x.org', [PlatformAdminPermission.TENANTS_WRITE]),
      admin('cannot@x.org', []),
    ]);

    await service.create(
      { id: 't1', name: 'Circle', subdomain: 'circle' },
      'Asking for money',
    );

    expect(reportRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Asking for money',
        reporterEmail: null,
      }),
    );
    expect(utility.sendEmailWithTemplate).toHaveBeenCalledTimes(1);
    expect(utility.sendEmailWithTemplate.mock.calls[0][0]).toBe('can@x.org');
  });

  it('reports a missing or already reviewed report', async () => {
    reportRepo.update.mockResolvedValue({ affected: 0 });
    await expect(service.markReviewed('r1')).rejects.toThrow(NotFoundException);
  });
});
