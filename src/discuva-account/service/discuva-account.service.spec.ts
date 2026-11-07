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

const qb = (result: unknown) => ({
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  getOne: jest.fn().mockResolvedValue(result),
  getOneOrFail: jest.fn().mockResolvedValue(result),
});

const accountRepo = {
  createQueryBuilder: jest.fn(),
  exists: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
  update: jest.fn(),
};
const linkRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
};
const tenantRepo = { find: jest.fn() };
const memberRepo = {
  createQueryBuilder: jest.fn(),
  update: jest.fn().mockResolvedValue({ affected: 1 }),
};
const sessionService = { updateLogout: jest.fn().mockResolvedValue(undefined) };
const settings = { getNumber: jest.fn() };
const config = { get: jest.fn() };
const store: Record<string, unknown> = {};
const cls = {
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

describe('DiscuvaAccountService', () => {
  let service: DiscuvaAccountService;

  beforeEach(async () => {
    jest.clearAllMocks();
    Object.assign(store, { tenantId: 't1', schemaName: 'church_a' });
    settings.getNumber.mockResolvedValue(2);
    config.get.mockReturnValue('');
    const module = await Test.createTestingModule({
      providers: [
        DiscuvaAccountService,
        { provide: getRepositoryToken(DiscuvaAccount), useValue: accountRepo },
        { provide: getRepositoryToken(DiscuvaAccountLink), useValue: linkRepo },
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
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
      expect(linkRepo.save).toHaveBeenCalledWith({
        accountId: 'a1',
        tenantId: 't1',
        memberId: 'm1',
      });
      expect(memberRepo.update).toHaveBeenCalledWith('m1', {
        discuvaAccountId: 'a1',
      });
    });

    it('never links to an existing account on the password alone', async () => {
      linkRepo.findOne.mockResolvedValue(null);
      accountRepo.findOne.mockResolvedValue({ id: 'a-other' });
      await expect(service.moveOnSignIn(adult)).resolves.toBe('LINK_AVAILABLE');
      expect(linkRepo.save).not.toHaveBeenCalled();
      expect(memberRepo.update).not.toHaveBeenCalled();
    });

    it('treats a lost race for the same email as an existing account', async () => {
      linkRepo.findOne.mockResolvedValue(null);
      accountRepo.findOne.mockResolvedValue(null);
      memberRepo.createQueryBuilder.mockReturnValue(qb({ password: 'h' }));
      accountRepo.save.mockRejectedValue(new Error('duplicate key'));
      await expect(service.moveOnSignIn(adult)).resolves.toBe('LINK_AVAILABLE');
      expect(linkRepo.save).not.toHaveBeenCalled();
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

    it('moves the device on the account and on both church copies', async () => {
      await service.setDevice(moved, 'phone-2');
      expect(accountRepo.update).toHaveBeenCalledWith('a1', {
        deviceId: 'phone-2',
      });
      expect(memberRepo.update).toHaveBeenCalledWith('m1', {
        deviceId: 'phone-2',
      });
      expect(memberRepo.update).toHaveBeenCalledWith('m2', {
        deviceId: 'phone-2',
      });
      expect(cls.runWith).toHaveBeenCalledTimes(1);
      expect(cls.runWith).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't2', schemaName: 'church_b' }),
        expect.any(Function),
      );
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
      await service.setDevice({ id: 'm1', discuvaAccountId: null }, null);
      expect(accountRepo.update).not.toHaveBeenCalled();
      expect(memberRepo.update).toHaveBeenCalledWith('m1', { deviceId: null });
      expect(cls.runWith).not.toHaveBeenCalled();
    });
  });
});
