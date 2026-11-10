import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { DiscuvaAccountService } from './discuva-account.service';
import { DiscuvaAccount } from '../entity/discuva-account.entity';
import { DiscuvaAccountLink } from '../entity/discuva-account-link.entity';
import { Member } from '../../member/entity/member.entity';
import { MemberSessionService } from '../../member/service/member-session.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { UtilityService } from '../../utility/service/utility.service';
import { SessionSurface } from '../../auth/enum/session-surface.enum';
import { DiscuvaAccountCodePurpose } from '../entity/discuva-account-code.entity';
import { DiscuvaAccountCodeService } from './discuva-account-code.service';
import { Admin } from '../../admin/entity/admin.entity';
import { NetworkHome } from '../entity/network-home.entity';

const qb = (result: unknown) => ({
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  getOne: jest.fn().mockResolvedValue(result),
  getOneOrFail: jest.fn().mockResolvedValue(result),
});

const accountRepo = {
  manager: { query: jest.fn() },
  delete: jest.fn(),
  createQueryBuilder: jest.fn(),
  exists: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
  update: jest.fn(),
};
const linkRepo = {
  update: jest.fn(),
  upsert: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
};
const tenantRepo = { find: jest.fn() };
const adminRepo = { exists: jest.fn() };
const utilityService = {
  resolveMemberUrl: jest.fn(async (p: string) => `https://church.example${p}`),
};
const codes = {
  issueLinkToken: jest.fn().mockResolvedValue('t'.repeat(64)),
  findLinkToken: jest.fn(),
  markUsed: jest.fn(),
};
const memberRepo = {
  createQueryBuilder: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn().mockResolvedValue({ affected: 1 }),
};
const sessionService = { updateLogout: jest.fn().mockResolvedValue(undefined) };
const settings = { getNumber: jest.fn() };
const config = { get: jest.fn() };
const store: Record<string, unknown> = {};
const cls = {
  isActive: jest.fn(() => false),
  set: jest.fn((k: string, v: unknown) => void (store[k] = v)),
  get: jest.fn((k: string) => store[k]),
  runWith: jest.fn((ctx: Record<string, unknown>, fn: () => unknown) => {
    const saved = { ...store };
    Object.assign(store, ctx);
    return Promise.resolve(fn()).finally(() => Object.assign(store, saved));
  }),
};
const txHost = {
  withTransaction: jest.fn((fn: () => unknown) => fn()),
  tx: { query: jest.fn() },
};

const adult = {
  id: 'm1',
  email: 'ada@example.com',
  birthYear: null,
  birthMonth: null,
  birthDay: null,
  discuvaAccountId: null,
} as unknown as Member;

const homeQb = {
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  orIgnore: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue(undefined),
};
const homeRepo = {
  findOne: jest.fn().mockResolvedValue(null),
  createQueryBuilder: jest.fn(() => homeQb),
};

describe('DiscuvaAccountService', () => {
  let service: DiscuvaAccountService;

  beforeEach(async () => {
    jest.clearAllMocks();
    Object.assign(store, { tenantId: 't1', schemaName: 'church_a' });
    settings.getNumber.mockImplementation(async (key: string) =>
      key === 'discuva_account_mode'
        ? 2
        : key === 'account_code_requests_per_hour'
          ? 3
          : key === 'account_code_max_attempts'
            ? 5
            : 10,
    );
    config.get.mockReturnValue('');
    const module = await Test.createTestingModule({
      providers: [
        DiscuvaAccountService,
        { provide: getRepositoryToken(DiscuvaAccount), useValue: accountRepo },
        { provide: getRepositoryToken(DiscuvaAccountLink), useValue: linkRepo },
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        { provide: getRepositoryToken(NetworkHome), useValue: homeRepo },
        { provide: DiscuvaAccountCodeService, useValue: codes },
        { provide: getRepositoryToken(Admin), useValue: adminRepo },
        { provide: UtilityService, useValue: utilityService },
        { provide: getRepositoryToken(Member), useValue: memberRepo },
        { provide: MemberSessionService, useValue: sessionService },
        { provide: PlatformSettingsService, useValue: settings },
        { provide: ConfigService, useValue: config },
        { provide: ClsService, useValue: cls },
        { provide: TransactionHost, useValue: txHost },
      ],
    }).compile();
    service = module.get(DiscuvaAccountService);
  });

  describe('the switch', () => {
    it('is off by default and on for everyone at 2', async () => {
      settings.getNumber.mockResolvedValueOnce(0);
      await expect(service.isOn()).resolves.toBe(false);
      await expect(service.isOn()).resolves.toBe(true);
    });

    it('in test mode is on only for the listed church addresses', async () => {
      settings.getNumber.mockResolvedValue(1);
      config.get.mockReturnValue(' frontend-test , other ');
      tenantRepo.find.mockResolvedValue([{ id: 't1' }]);
      await expect(service.isOn()).resolves.toBe(true);
      store.tenantId = 't9';
      await expect(service.isOn()).resolves.toBe(false);
      expect(tenantRepo.find).toHaveBeenCalledTimes(1);
    });

    it('turns Global Profile on only where One Discuva sign-in is also on', async () => {
      const modes = (account: number, profile: number) =>
        settings.getNumber.mockImplementation(async (key: string) =>
          key === 'discuva_account_mode'
            ? account
            : key === 'discuva_profile_mode'
              ? profile
              : 10,
        );
      modes(2, 0);
      await expect(service.isProfileOn()).resolves.toBe(false);
      modes(0, 2);
      await expect(service.isProfileOn()).resolves.toBe(false);
      modes(2, 2);
      await expect(service.isProfileOn()).resolves.toBe(true);
    });
  });

  describe('checking a password', () => {
    it('uses the church copy until the member has moved', async () => {
      const verify = jest
        .spyOn(UtilityService, 'verifyHashedValue')
        .mockResolvedValue(true);
      await service.verifyPassword(
        { discuvaAccountId: null, password: 'church-hash' },
        'secret',
      );
      expect(verify).toHaveBeenCalledWith('secret', 'church-hash');
      expect(accountRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('uses only the account once moved, never falling back to the church copy', async () => {
      accountRepo.createQueryBuilder.mockReturnValue(
        qb({ id: 'a1', password: 'account-hash' }),
      );
      const verify = jest
        .spyOn(UtilityService, 'verifyHashedValue')
        .mockResolvedValue(false);
      const ok = await service.verifyPassword(
        { discuvaAccountId: 'a1', password: 'church-hash' },
        'secret',
      );
      expect(ok).toBe(false);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify).toHaveBeenCalledWith('secret', 'account-hash');
    });

    it('goes back to the church copy when the switch is off, even for moved members', async () => {
      settings.getNumber.mockResolvedValue(0);
      const verify = jest
        .spyOn(UtilityService, 'verifyHashedValue')
        .mockResolvedValue(true);
      await service.verifyPassword(
        { discuvaAccountId: 'a1', password: 'church-hash' },
        'secret',
      );
      expect(verify).toHaveBeenCalledWith('secret', 'church-hash');
    });
  });

  describe('moving over at sign-in', () => {
    it('creates the account from the church record when none exists', async () => {
      linkRepo.findOne.mockResolvedValue(null);
      accountRepo.findOne.mockResolvedValue(null);
      memberRepo.createQueryBuilder.mockReturnValue(
        qb({ password: 'church-hash', deviceId: 'phone-1' }),
      );
      accountRepo.save.mockResolvedValue({ id: 'a1' });

      await expect(
        service.moveOnSignIn({ ...adult, email: 'Ada@Example.com ' } as Member),
      ).resolves.toBe('MOVED');

      expect(accountRepo.create).toHaveBeenCalledWith({
        email: 'ada@example.com',
        password: 'church-hash',
        deviceId: 'phone-1',
      });
      expect(linkRepo.upsert).toHaveBeenCalledWith(
        { accountId: 'a1', tenantId: 't1', memberId: 'm1' },
        ['tenantId', 'memberId'],
      );
      expect(memberRepo.update).toHaveBeenCalledWith('m1', {
        discuvaAccountId: 'a1',
      });
    });

    it('never links to an existing account on the password alone', async () => {
      linkRepo.findOne.mockResolvedValue(null);
      accountRepo.findOne.mockResolvedValue({ id: 'a-other' });
      await expect(service.moveOnSignIn(adult)).resolves.toBe('LINK_AVAILABLE');
      expect(linkRepo.upsert).not.toHaveBeenCalled();
      expect(memberRepo.update).not.toHaveBeenCalled();
    });

    it('treats a lost race for the same email as an existing account', async () => {
      linkRepo.findOne.mockResolvedValue(null);
      accountRepo.findOne.mockResolvedValue(null);
      memberRepo.createQueryBuilder.mockReturnValue(qb({ password: 'h' }));
      accountRepo.save.mockRejectedValue(new Error('duplicate key'));
      await expect(service.moveOnSignIn(adult)).resolves.toBe('LINK_AVAILABLE');
      expect(linkRepo.upsert).not.toHaveBeenCalled();
    });

    it('finishes a move that stopped half way', async () => {
      linkRepo.findOne.mockResolvedValue({ accountId: 'a1' });
      await expect(service.moveOnSignIn(adult)).resolves.toBe('MOVED');
      expect(memberRepo.update).toHaveBeenCalledWith('m1', {
        discuvaAccountId: 'a1',
      });
      expect(accountRepo.save).not.toHaveBeenCalled();
    });

    it('leaves under-18s on church-only sign-in, counting unknown birthdays as late in the year', async () => {
      jest.useFakeTimers({ now: new Date('2026-06-15T12:00:00Z') });
      try {
        await expect(
          service.moveOnSignIn({ ...adult, birthYear: 2009 } as Member),
        ).resolves.toBe('NONE');
        await expect(
          service.moveOnSignIn({
            ...adult,
            birthYear: 2008,
            birthMonth: 7,
          } as Member),
        ).resolves.toBe('NONE');
        expect(linkRepo.findOne).not.toHaveBeenCalled();
        linkRepo.findOne.mockResolvedValue({ accountId: 'a1' });
        await expect(
          service.moveOnSignIn({
            ...adult,
            birthYear: 2008,
            birthMonth: 6,
            birthDay: 15,
          } as Member),
        ).resolves.toBe('MOVED');
      } finally {
        jest.useRealTimers();
      }
    });

    it('does nothing when the switch is off', async () => {
      settings.getNumber.mockResolvedValue(0);
      await expect(service.moveOnSignIn(adult)).resolves.toBe('NONE');
      expect(linkRepo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('changes for a moved member reach every church', () => {
    const moved = { id: 'm1', discuvaAccountId: 'a1' };

    beforeEach(() => {
      accountRepo.createQueryBuilder.mockReturnValue(qb({ id: 'a1' }));
      linkRepo.find.mockResolvedValue([
        { tenantId: 't1', memberId: 'm1' },
        { tenantId: 't2', memberId: 'm2' },
      ]);
      tenantRepo.find.mockResolvedValue([{ id: 't2', schemaName: 'church_b' }]);
    });

    it('Reset Device Access moves this church app to the new phone and clears the others', async () => {
      await service.resetDevices(moved, 'phone-2');
      expect(accountRepo.update).toHaveBeenCalledWith('a1', {
        deviceId: 'phone-2',
      });
      expect(memberRepo.update).toHaveBeenCalledWith('m1', {
        deviceId: 'phone-2',
      });
      expect(memberRepo.update).toHaveBeenCalledWith('m2', { deviceId: null });
      expect(cls.runWith).toHaveBeenCalledTimes(1);
      expect(cls.runWith).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't2', schemaName: 'church_b' }),
        expect.any(Function),
      );
    });

    it('an admin clearing the lock clears every church app', async () => {
      await service.clearDevices(moved);
      expect(memberRepo.update).toHaveBeenCalledWith('m1', { deviceId: null });
      expect(memberRepo.update).toHaveBeenCalledWith('m2', { deviceId: null });
    });

    it("registering a phone touches only this church's record", async () => {
      await service.registerDevice(moved, 'phone-3');
      expect(memberRepo.update).toHaveBeenCalledTimes(1);
      expect(memberRepo.update).toHaveBeenCalledWith('m1', {
        deviceId: 'phone-3',
      });
      expect(cls.runWith).not.toHaveBeenCalled();
    });

    it('asks a church app on an unknown phone to confirm, but not one sharing a known phone id', async () => {
      memberRepo.createQueryBuilder.mockReturnValue(
        qb({ id: 'm2', deviceId: 'church-a-app' }),
      );
      const fresh = { ...moved, deviceId: null };
      await expect(
        service.needsDeviceConfirmation(fresh, 'church-b-app'),
      ).resolves.toBe(true);
      await expect(
        service.needsDeviceConfirmation(fresh, 'church-a-app'),
      ).resolves.toBe(false);
      await expect(
        service.needsDeviceConfirmation(
          { ...fresh, deviceId: 'church-b-app' },
          'church-b-app',
        ),
      ).resolves.toBe(false);
    });

    it('lets the first phone register freely when no church app has one yet', async () => {
      memberRepo.createQueryBuilder.mockReturnValue(
        qb({ id: 'm2', deviceId: null }),
      );
      await expect(
        service.needsDeviceConfirmation(
          { ...moved, deviceId: null },
          'phone-1',
        ),
      ).resolves.toBe(false);
    });

    it('writes a new password to the account and every church copy', async () => {
      await service.setPasswordHash(moved, 'new-hash', true);
      expect(accountRepo.update).toHaveBeenCalledWith(
        'a1',
        expect.objectContaining({ password: 'new-hash' }),
      );
      expect(memberRepo.update).toHaveBeenCalledWith('m2', {
        password: 'new-hash',
        changedPassword: true,
      });
    });

    it('signs out everywhere, or only at the other churches when asked', async () => {
      await service.endSessionsEverywhere(moved);
      expect(sessionService.updateLogout).toHaveBeenCalledTimes(4);
      sessionService.updateLogout.mockClear();
      await service.endSessionsEverywhere(moved, { skipCurrent: true });
      expect(sessionService.updateLogout).toHaveBeenCalledTimes(2);
      expect(sessionService.updateLogout).toHaveBeenCalledWith(
        'm2',
        SessionSurface.ADMIN,
      );
    });

    it('acts on this church only for a member who has not moved', async () => {
      await service.clearDevices({ id: 'm1', discuvaAccountId: null });
      expect(accountRepo.update).not.toHaveBeenCalled();
      expect(memberRepo.update).toHaveBeenCalledWith('m1', { deviceId: null });
      expect(cls.runWith).not.toHaveBeenCalled();
    });
  });

  describe('combining two accounts', () => {
    it("moves the other account's churches, milestones and photo history, then removes it", async () => {
      accountRepo.createQueryBuilder.mockReturnValue(
        qb({ id: 'keep', email: 'ada@example.com', password: 'hash' }),
      );
      linkRepo.find.mockResolvedValue([{ tenantId: 't2', memberId: 'm2' }]);
      tenantRepo.find.mockResolvedValue([{ id: 't2', schemaName: 'church_b' }]);

      await service.mergeInto('keep', 'gone');

      expect(memberRepo.update).toHaveBeenCalledWith('m2', {
        discuvaAccountId: 'keep',
        email: 'ada@example.com',
        password: 'hash',
      });
      expect(linkRepo.update).toHaveBeenCalledWith(
        { accountId: 'gone' },
        { accountId: 'keep' },
      );
      const sql = accountRepo.manager.query.mock.calls.map(([q]) => q);
      expect(sql[0]).toContain('DELETE FROM public.discuva_milestones');
      expect(sql[1]).toContain('UPDATE public.discuva_milestones');
      expect(sql[2]).toContain('UPDATE public.discuva_photo_removals');
      expect(accountRepo.delete).toHaveBeenCalledWith('gone');
    });

    it('knows when two accounts share a church', async () => {
      linkRepo.find
        .mockResolvedValueOnce([{ tenantId: 't1' }])
        .mockResolvedValueOnce([{ tenantId: 't2' }, { tenantId: 't1' }]);
      await expect(service.sharesChurch('a', 'b')).resolves.toBe(true);
    });
  });

  describe('deleting an account', () => {
    it('leaves each church a "Former member" record without personal details, then removes the account', async () => {
      linkRepo.find.mockResolvedValue([{ tenantId: 't2', memberId: 'm2' }]);
      tenantRepo.find.mockResolvedValue([{ id: 't2', schemaName: 'church_b' }]);
      memberRepo.findOne.mockResolvedValue({
        id: 'm2',
        photoPublicId: 'tenants/t2/profile-pictures/1',
      });

      const files = await service.erase('acc-1');

      expect(memberRepo.update).toHaveBeenCalledWith(
        'm2',
        expect.objectContaining({
          firstname: 'Former',
          lastname: 'member',
          email: 'former-m2@deleted.invalid',
          discuvaAccountId: null,
          status: 'INACTIVE',
          phoneNumber: null,
          address: null,
          emergencyContactPhone: null,
          photoUrl: null,
        }),
      );
      expect(sessionService.updateLogout).toHaveBeenCalled();
      expect(accountRepo.delete).toHaveBeenCalledWith('acc-1');
      expect(files).toEqual(['tenants/t2/profile-pictures/1']);
    });
  });

  describe('freezing, email changes and recovery', () => {
    beforeEach(() => {
      accountRepo.createQueryBuilder.mockReturnValue(
        qb({
          id: 'a1',
          email: 'old@example.com',
          password: 'h',
          deviceId: 'phone-123',
        }),
      );
      linkRepo.find.mockResolvedValue([
        { tenantId: 't1', memberId: 'm1' },
        { tenantId: 't2', memberId: 'm2' },
      ]);
      tenantRepo.find.mockResolvedValue([{ id: 't2', schemaName: 'church_b' }]);
    });

    it('freezes the account and signs out at every church', async () => {
      await service.freeze('a1');
      expect(accountRepo.update).toHaveBeenCalledWith('a1', {
        frozenAt: expect.any(Date),
      });
      expect(sessionService.updateLogout).toHaveBeenCalledTimes(4);
    });

    it('a new password unfreezes the account', async () => {
      await service.setPasswordHash(
        { id: 'm1', discuvaAccountId: 'a1' },
        'new',
        true,
      );
      expect(accountRepo.update).toHaveBeenCalledWith(
        'a1',
        expect.objectContaining({ frozenAt: null }),
      );
    });

    it("won't move the account to an email someone else uses at one of its churches", async () => {
      accountRepo.findOne.mockResolvedValue(null);
      memberRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'someone-else' });
      await expect(
        service.changeEmail('a1', 'taken@example.com'),
      ).rejects.toThrow('already in use');
      expect(accountRepo.update).not.toHaveBeenCalled();
    });

    it('changes the email on the account and every church copy', async () => {
      accountRepo.findOne.mockResolvedValue(null);
      memberRepo.findOne.mockResolvedValue(null);
      await expect(service.changeEmail('a1', 'New@Example.com')).resolves.toBe(
        'old@example.com',
      );
      expect(accountRepo.update).toHaveBeenCalledWith('a1', {
        email: 'new@example.com',
      });
      expect(memberRepo.update).toHaveBeenCalledWith('m2', {
        email: 'new@example.com',
      });
    });

    it('undoing an email change puts the old one back, then uses up the link and freezes the account', async () => {
      codes.findLinkToken.mockResolvedValue({
        id: 'c1',
        email: 'old@example.com',
      });
      accountRepo.findOne.mockResolvedValue(null);
      memberRepo.findOne.mockResolvedValue(null);
      await expect(service.undoEmailChange('a1', 'f'.repeat(64))).resolves.toBe(
        'old@example.com',
      );
      expect(accountRepo.update).toHaveBeenCalledWith('a1', {
        email: 'old@example.com',
      });
      expect(accountRepo.update).toHaveBeenCalledWith('a1', {
        frozenAt: expect.any(Date),
      });
      expect(codes.markUsed).toHaveBeenCalledWith('c1');
    });

    it('keeps the undo link when the old email has since been taken, so it can be tried again', async () => {
      codes.findLinkToken.mockResolvedValue({
        id: 'c1',
        email: 'old@example.com',
      });
      accountRepo.findOne.mockResolvedValue({ id: 'someone-else' });
      await expect(
        service.undoEmailChange('a1', 'f'.repeat(64)),
      ).rejects.toThrow('already in use');
      expect(codes.markUsed).not.toHaveBeenCalled();
    });

    it('a freeze link freezes, then is used up', async () => {
      codes.findLinkToken.mockResolvedValue({ id: 'c9' });
      await service.freezeWithLink('a1', 'f'.repeat(64));
      expect(codes.findLinkToken).toHaveBeenCalledWith(
        'a1',
        DiscuvaAccountCodePurpose.FREEZE,
        'f'.repeat(64),
      );
      expect(accountRepo.update).toHaveBeenCalledWith('a1', {
        frozenAt: expect.any(Date),
      });
      expect(codes.markUsed).toHaveBeenCalledWith('c9');
    });

    it('recovery clears the device, sets an unknown password and signs out everywhere', async () => {
      accountRepo.findOne.mockResolvedValue(null);
      memberRepo.findOne.mockResolvedValue(null);
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('random-hash');
      await expect(service.recover('a1', 'new@example.com')).resolves.toBe(
        'old@example.com',
      );
      expect(accountRepo.update).toHaveBeenCalledWith(
        'a1',
        expect.objectContaining({
          deviceId: null,
          password: 'random-hash',
          frozenAt: null,
          recoveredAt: expect.any(Date),
        }),
      );
      expect(memberRepo.update).toHaveBeenCalledWith('m2', {
        deviceId: null,
        password: 'random-hash',
        changedPassword: true,
      });
      expect(sessionService.updateLogout).toHaveBeenCalledTimes(4);
    });

    it('only looks for admin roles at the other churches', async () => {
      adminRepo.exists.mockResolvedValue(true);
      await expect(service.isAdminAtAnotherChurch('a1')).resolves.toBe(true);
      expect(adminRepo.exists).toHaveBeenCalledTimes(1);
      expect(adminRepo.exists).toHaveBeenCalledWith({
        where: { member: { id: 'm2' }, isActive: true },
      });
    });
  });

  describe('one request reads an account once', () => {
    beforeEach(() => {
      cls.isActive.mockReturnValue(true);
      delete store.discuvaAccountMemo;
      accountRepo.createQueryBuilder.mockReturnValue(
        qb({ id: 'a1', password: 'h', deviceId: 'phone-123' }),
      );
      linkRepo.find.mockResolvedValue([{ tenantId: 't1', memberId: 'm1' }]);
    });
    afterEach(() => cls.isActive.mockReturnValue(false));

    it('reuses the first read for password, device and freeze checks', async () => {
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(true);
      const moved = { discuvaAccountId: 'a1', password: 'x', deviceId: null };
      await service.accountFor(moved);
      await service.verifyPassword(moved, 'pw');
      await service.isFrozen(moved);
      expect(accountRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(settings.getNumber).toHaveBeenCalledTimes(1);
    });

    it('reads again after a change in the same request', async () => {
      const moved = { id: 'm1', discuvaAccountId: 'a1', deviceId: null };
      await service.isFrozen(moved);
      await service.resetDevices(moved, 'phone-2');
      await service.isFrozen(moved);
      // The second read happens inside resetDevices, after its write, and is the one reused.
      expect(accountRepo.createQueryBuilder).toHaveBeenCalledTimes(2);
    });
  });

  describe('homeIn', () => {
    it('uses a saved home branch', async () => {
      homeRepo.findOne.mockResolvedValueOnce({ homeTenantId: 'ikeja' });
      await expect(service.homeIn('acc-1', 'abc')).resolves.toBe('ikeja');
    });

    it('falls back to the first church joined in that network, and remembers it', async () => {
      homeRepo.findOne.mockResolvedValueOnce(null);
      linkRepo.find.mockResolvedValueOnce([
        { tenantId: 'elsewhere', linkedAt: new Date('2025-01-01') },
        { tenantId: 'lekki', linkedAt: new Date('2025-02-01') },
        { tenantId: 'ikeja', linkedAt: new Date('2025-03-01') },
      ]);
      tenantRepo.find.mockResolvedValueOnce([{ id: 'ikeja' }, { id: 'lekki' }]);
      await expect(service.homeIn('acc-1', 'abc')).resolves.toBe('lekki');
      expect(homeQb.values).toHaveBeenCalledWith({
        accountId: 'acc-1',
        networkRootId: 'abc',
        homeTenantId: 'lekki',
      });
    });
  });
});
