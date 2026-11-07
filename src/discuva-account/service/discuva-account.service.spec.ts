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
import {
  DiscuvaAccountCode,
  DiscuvaAccountCodePurpose,
} from '../entity/discuva-account-code.entity';
import { CacheService } from '../../utility/service/cache.service';
import { HttpException, BadRequestException } from '@nestjs/common';

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
const codeRepo = {
  delete: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
  findOne: jest.fn(),
  update: jest.fn(),
};
const counters = new Map<string, number>();
const cache = {
  incrGlobal: jest.fn(async (k: string) => {
    counters.set(k, (counters.get(k) ?? 0) + 1);
    return counters.get(k)!;
  }),
  getGlobal: jest.fn(async (k: string) => counters.get(k)),
  delGlobal: jest.fn(async (k: string) => Number(counters.delete(k))),
};
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
    settings.getNumber.mockImplementation(async (key: string) =>
      key === 'discuva_account_mode'
        ? 2
        : key === 'account_code_requests_per_hour'
          ? 3
          : key === 'account_code_max_attempts'
            ? 5
            : 10,
    );
    counters.clear();
    config.get.mockReturnValue('');
    const module = await Test.createTestingModule({
      providers: [
        DiscuvaAccountService,
        { provide: getRepositoryToken(DiscuvaAccount), useValue: accountRepo },
        { provide: getRepositoryToken(DiscuvaAccountLink), useValue: linkRepo },
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        { provide: getRepositoryToken(DiscuvaAccountCode), useValue: codeRepo },
        { provide: CacheService, useValue: cache },
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

  describe('emailed codes', () => {
    const P = DiscuvaAccountCodePurpose.JOIN;

    it('replaces only this device’s earlier code and keeps just a hash', async () => {
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('code-hash');
      const code = await service.issueCode('Ada@Example.com', P, 'phone-123');
      expect(code).toMatch(/^\d{6}$/);
      expect(codeRepo.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'ada@example.com',
          purpose: P,
          deviceId: 'phone-123',
        }),
      );
      expect(codeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ codeHash: 'code-hash', tenantId: 't1' }),
      );
      expect(JSON.stringify(codeRepo.save.mock.calls)).not.toContain(code);
    });

    it('limits how many codes one email and device can ask for', async () => {
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('h');
      for (let i = 0; i < 3; i++)
        await service.issueCode('a@b.co', P, 'phone-123');
      await expect(service.issueCode('a@b.co', P, 'phone-123')).rejects.toThrow(
        HttpException,
      );
      await expect(
        service.issueCode('a@b.co', P, 'other-phone'),
      ).resolves.toMatch(/^\d{6}$/);
    });

    it('uses a right code once and counts wrong ones per device', async () => {
      codeRepo.findOne.mockResolvedValue({
        id: 'c1',
        codeHash: 'h',
        expiresAt: new Date(Date.now() + 60_000),
      });
      jest
        .spyOn(UtilityService, 'verifyHashedValue')
        .mockImplementation(async (code: string) => code === '123456');

      for (let i = 0; i < 5; i++) {
        await expect(
          service.verifyCode('a@b.co', P, 'stranger-1', '000000'),
        ).rejects.toThrow(BadRequestException);
      }
      await expect(
        service.verifyCode('a@b.co', P, 'stranger-1', '123456'),
      ).rejects.toThrow(HttpException);
      await expect(
        service.verifyCode('a@b.co', P, 'owner-phone', '123456'),
      ).resolves.toBeUndefined();
      expect(codeRepo.update).toHaveBeenCalledWith('c1', {
        usedAt: expect.any(Date),
      });
    });

    it('refuses an expired code', async () => {
      codeRepo.findOne.mockResolvedValue({
        id: 'c1',
        codeHash: 'h',
        expiresAt: new Date(Date.now() - 1),
      });
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(true);
      await expect(
        service.verifyCode('a@b.co', P, 'phone-123', '123456'),
      ).rejects.toThrow(BadRequestException);
      expect(codeRepo.update).not.toHaveBeenCalled();
    });
  });
});
