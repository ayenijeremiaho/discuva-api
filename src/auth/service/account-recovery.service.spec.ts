import { mockAdminAccess } from '../../admin/testing/admin-access.mock';
import { AdminAccessService } from '../../admin/service/admin-access.service';
import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AccountRecoveryService } from './account-recovery.service';
import { DiscuvaAccountService } from '../../discuva-account/service/discuva-account.service';
import { DiscuvaAccountCodeService } from '../../discuva-account/service/discuva-account-code.service';
import { MemberService } from '../../member/service/member.service';
import { AdminService } from '../../admin/service/admin.service';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { WebauthnService } from './webauthn.service';
import { AuthService } from './auth.service';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';

const codes = { sendCode: jest.fn(), verifyCode: jest.fn() };
const accounts = {
  isOn: jest.fn(),
  accountFor: jest.fn(),
  isAdminAtAnotherChurch: jest.fn(),
  emailInUse: jest.fn(),
  recover: jest.fn().mockResolvedValue('old@example.com'),
  forEachLinkedMember: jest.fn(
    async (_id: string, fn: (m: string) => Promise<void>) => {
      await fn('m-target');
      await fn('m-elsewhere');
    },
  ),
};
const members: Record<string, object> = {
  'm-target': { id: 'm-target', firstname: 'ada', discuvaAccountId: 'a1' },
  'm-admin': { id: 'm-admin', firstname: 'admin', discuvaAccountId: null },
};
const memberService = { getById: jest.fn(async (id: string) => members[id]) };
const adminService = {
  findByMemberId: jest.fn(),
  assertCanRecoverFormAccess: jest.fn().mockResolvedValue(undefined),
};
const utility = {
  resolveChurchName: jest.fn().mockResolvedValue('the church'),
  sendEmailWithTemplate: jest.fn(),
};
const audit = { log: jest.fn() };
const settings = { getNumber: jest.fn().mockResolvedValue(7) };
const push = { unsubscribe: jest.fn() };
const webauthn = { revokeAllCredentials: jest.fn() };
const authService = { forgotPassword: jest.fn() };

const role = (...permissions: AdminPermission[]) => ({
  adminRole: { permissions },
  isOwner: false,
});

describe('AccountRecoveryService', () => {
  let service: AccountRecoveryService;

  beforeEach(async () => {
    jest.clearAllMocks();
    accounts.isOn.mockResolvedValue(true);
    accounts.accountFor.mockResolvedValue({
      id: 'a1',
      email: 'old@example.com',
      recoveredAt: null,
    });
    accounts.isAdminAtAnotherChurch.mockResolvedValue(false);
    accounts.emailInUse.mockResolvedValue(false);
    adminService.findByMemberId.mockResolvedValue(null);
    const module = await Test.createTestingModule({
      providers: [
        { provide: AdminAccessService, useValue: mockAdminAccess },
        AccountRecoveryService,
        { provide: DiscuvaAccountService, useValue: accounts },
        { provide: DiscuvaAccountCodeService, useValue: codes },
        { provide: MemberService, useValue: memberService },
        { provide: AdminService, useValue: adminService },
        { provide: UtilityService, useValue: utility },
        { provide: AuditLogService, useValue: audit },
        { provide: PlatformSettingsService, useValue: settings },
        { provide: PushNotificationService, useValue: push },
        { provide: WebauthnService, useValue: webauthn },
        { provide: AuthService, useValue: authService },
      ],
    }).compile();
    service = module.get(AccountRecoveryService);
  });

  it('sends a code to the new email for the person to read out', async () => {
    await service.start('m-admin', 'm-target', 'new@example.com');
    expect(codes.sendCode).toHaveBeenCalledWith(
      'new@example.com',
      'RECOVER',
      'admin:m-admin',
      expect.objectContaining({ action: expect.stringContaining('in person') }),
    );
  });

  it('points members without an account to the existing tools', async () => {
    accounts.accountFor.mockResolvedValue(null);
    await expect(
      service.start('m-admin', 'm-target', 'new@example.com'),
    ).rejects.toThrow(BadRequestException);
  });

  it("won't let anyone recover their own account", async () => {
    await expect(
      service.start('m-target', 'm-target', 'new@example.com'),
    ).rejects.toThrow(ForbiddenException);
    members['m-admin'] = { ...members['m-admin'], discuvaAccountId: 'a1' };
    await expect(
      service.start('m-admin', 'm-target', 'new@example.com'),
    ).rejects.toThrow(ForbiddenException);
    members['m-admin'] = { ...members['m-admin'], discuvaAccountId: null };
  });

  it('needs Manage Admin Users & Roles to recover an admin', async () => {
    adminService.findByMemberId.mockImplementation(async (id: string) =>
      id === 'm-target'
        ? role(AdminPermission.MEMBERS_READ)
        : role(AdminPermission.MEMBERS_WRITE),
    );
    await expect(
      service.start('m-admin', 'm-target', 'new@example.com'),
    ).rejects.toThrow('Manage Admin Users & Roles');
  });

  it("won't let a smaller role recover a bigger one, or a non-owner recover an owner", async () => {
    adminService.findByMemberId.mockImplementation(async (id: string) =>
      id === 'm-target'
        ? role(AdminPermission.ADMIN_WRITE, AdminPermission.BILLING_WRITE)
        : role(AdminPermission.ADMIN_WRITE, AdminPermission.MEMBERS_WRITE),
    );
    await expect(
      service.start('m-admin', 'm-target', 'new@example.com'),
    ).rejects.toThrow('can do more');

    adminService.findByMemberId.mockImplementation(async (id: string) =>
      id === 'm-target'
        ? { ...role(), isOwner: true }
        : role(AdminPermission.ADMIN_WRITE),
    );
    await expect(
      service.start('m-admin', 'm-target', 'new@example.com'),
    ).rejects.toThrow('can do more');
  });

  it('lets an admin with every permission the target has recover them', async () => {
    adminService.findByMemberId.mockImplementation(async (id: string) =>
      id === 'm-target'
        ? role(AdminPermission.MEMBERS_READ)
        : role(AdminPermission.ADMIN_WRITE, AdminPermission.MEMBERS_READ),
    );
    await expect(
      service.start('m-admin', 'm-target', 'new@example.com'),
    ).resolves.toBeUndefined();
  });

  it("leaves an admin of another church to that church's admins", async () => {
    accounts.isAdminAtAnotherChurch.mockResolvedValue(true);
    await expect(
      service.start('m-admin', 'm-target', 'new@example.com'),
    ).rejects.toThrow('another church');
  });

  it('waits the set number of days between recoveries', async () => {
    accounts.accountFor.mockResolvedValue({
      id: 'a1',
      recoveredAt: new Date(Date.now() - 2 * 86_400_000),
    });
    await expect(
      service.start('m-admin', 'm-target', 'new@example.com'),
    ).rejects.toThrow('recovered recently');
    accounts.accountFor.mockResolvedValue({
      id: 'a1',
      recoveredAt: new Date(Date.now() - 8 * 86_400_000),
    });
    await expect(
      service.start('m-admin', 'm-target', 'new@example.com'),
    ).resolves.toBeUndefined();
  });

  it('needs an email other than the one the account already uses', async () => {
    await expect(
      service.start('m-admin', 'm-target', 'Old@Example.com'),
    ).rejects.toThrow('already uses');
  });

  it("won't use an email someone else has", async () => {
    accounts.emailInUse.mockResolvedValue(true);
    await expect(
      service.start('m-admin', 'm-target', 'new@example.com'),
    ).rejects.toThrow(ConflictException);
  });

  it('after the code: recovers, clears phones and passkeys at every church, tells the old address', async () => {
    await service.confirm('m-admin', 'm-target', 'new@example.com', '123456');
    expect(codes.verifyCode).toHaveBeenCalledWith(
      'new@example.com',
      'RECOVER',
      'admin:m-admin',
      '123456',
    );
    expect(accounts.recover).toHaveBeenCalledWith('a1', 'new@example.com');
    expect(webauthn.revokeAllCredentials).toHaveBeenCalledWith('m-elsewhere');
    expect(push.unsubscribe).toHaveBeenCalledWith('m-elsewhere');
    expect(audit.log).toHaveBeenCalledTimes(2);
    expect(audit.log).toHaveBeenCalledWith(
      'ACCOUNT_RECOVERED',
      expect.objectContaining({ actorId: 'm-admin', targetId: 'm-target' }),
    );
    expect(audit.log.mock.calls[1][1]).toEqual(
      expect.not.objectContaining({ actorId: expect.anything() }),
    );
    expect(audit.log.mock.calls[1][1].targetId).toBe('m-elsewhere');
    expect(utility.sendEmailWithTemplate).toHaveBeenCalledWith(
      'old@example.com',
      expect.any(String),
      'discuva-account-recovered',
      expect.any(Object),
    );
    expect(authService.forgotPassword).toHaveBeenCalledWith('new@example.com');
  });

  it('changes nothing when the code is wrong', async () => {
    codes.verifyCode.mockRejectedValueOnce(new BadRequestException());
    await expect(
      service.confirm('m-admin', 'm-target', 'new@example.com', '000000'),
    ).rejects.toThrow(BadRequestException);
    expect(accounts.recover).not.toHaveBeenCalled();
  });
});
