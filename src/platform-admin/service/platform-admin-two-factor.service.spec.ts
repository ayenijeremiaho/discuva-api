import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { PlatformAdminTwoFactorService } from './platform-admin-two-factor.service';
import { PlatformAdmin } from '../entity/platform-admin.entity';
import { PlatformAdminSecurityEvent } from '../entity/platform-admin-security-event.entity';
import { CacheService } from '../../utility/service/cache.service';
import { EncryptionService } from '../../utility/service/encryption.service';
import { UtilityService } from '../../utility/service/utility.service';
import { totpAt } from '../../utility/two-factor/totp';

jest.mock('argon2');

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const stepNow = () => Math.floor(Date.now() / 30_000);
const codeNow = () => totpAt(SECRET, stepNow());

const store = new Map<string, unknown>();
const mockCache = {
  getGlobal: jest.fn(async (k: string) => store.get(k)),
  setGlobal: jest.fn(async (k: string, v: unknown) => {
    store.set(k, v);
  }),
  delGlobal: jest.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
  hitWindow: jest.fn().mockResolvedValue({ hits: 1, blockMsLeft: 0 }),
};
const mockEncryption = {
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace('enc:', '')),
};
const mockUtility = { sendEmailWithTemplate: jest.fn() };
const execute = jest.fn();
const updateBuilder = {
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  execute,
};
let admin: Partial<PlatformAdmin> | null;
const selectBuilder = {
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  getOne: jest.fn(async () => admin),
};
const mockRepo = {
  update: jest.fn(),
  createQueryBuilder: jest.fn((alias?: string) =>
    alias ? selectBuilder : updateBuilder,
  ),
};

const mockEvents = {
  insert: jest.fn().mockResolvedValue({}),
  find: jest.fn().mockResolvedValue([]),
};

const enabledAdmin = (): Partial<PlatformAdmin> => ({
  id: 'a1',
  email: 'a@example.com',
  isActive: true,
  passwordHash: 'hash',
  twoFactorEnabledAt: new Date(),
  twoFactorSecret: `enc:${SECRET}`,
  twoFactorBackupCodes: ['x'],
});

describe('PlatformAdminTwoFactorService', () => {
  let service: PlatformAdminTwoFactorService;

  beforeEach(async () => {
    jest.clearAllMocks();
    store.clear();
    admin = enabledAdmin();
    execute.mockResolvedValue({ affected: 1 });
    mockCache.hitWindow.mockResolvedValue({ hits: 1, blockMsLeft: 0 });
    (argon2.verify as jest.Mock).mockResolvedValue(true);
    const module = await Test.createTestingModule({
      providers: [
        PlatformAdminTwoFactorService,
        { provide: getRepositoryToken(PlatformAdmin), useValue: mockRepo },
        { provide: CacheService, useValue: mockCache },
        { provide: EncryptionService, useValue: mockEncryption },
        { provide: UtilityService, useValue: mockUtility },
        { provide: ConfigService, useValue: { get: () => 'Discuva' } },
        {
          provide: getRepositoryToken(PlatformAdminSecurityEvent),
          useValue: mockEvents,
        },
      ],
    }).compile();
    service = module.get(PlatformAdminTwoFactorService);
  });

  describe('sign-in', () => {
    it('accepts a correct app code once', async () => {
      const token = await service.createChallenge('a1');
      await expect(service.completeChallenge(token, codeNow())).resolves.toBe(
        'a1',
      );
      await expect(service.completeChallenge(token, codeNow())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a wrong code and keeps the challenge for another try', async () => {
      const token = await service.createChallenge('a1');
      const wrong = codeNow() === '000000' ? '111111' : '000000';
      await expect(service.completeChallenge(token, wrong)).rejects.toThrow(
        "didn't work",
      );
      await expect(service.completeChallenge(token, codeNow())).resolves.toBe(
        'a1',
      );
    });

    it('rejects a code that was already used', async () => {
      const token = await service.createChallenge('a1');
      execute.mockResolvedValue({ affected: 0 });
      await expect(service.completeChallenge(token, codeNow())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('accepts a backup code, however it is typed', async () => {
      const token = await service.createChallenge('a1');
      await expect(
        service.completeChallenge(token, 'abcd-efgh-ijkl-mnop'),
      ).resolves.toBe('a1');
      expect(updateBuilder.where).toHaveBeenCalledWith(
        expect.stringContaining('ANY(two_factor_backup_codes)'),
        expect.objectContaining({
          hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      );
    });

    it('emails and records when a backup code is used', async () => {
      const token = await service.createChallenge('a1');
      await service.completeChallenge(token, 'abcd-efgh-ijkl-mnop');
      expect(mockUtility.sendEmailWithTemplate).toHaveBeenCalledWith(
        'a@example.com',
        expect.stringContaining('A backup code was used'),
        'platform-admin-security-notice',
        expect.anything(),
      );
      expect(mockEvents.insert).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'BACKUP_CODE_USED' }),
      );
    });

    it('blocks after too many attempts', async () => {
      const token = await service.createChallenge('a1');
      mockCache.hitWindow.mockResolvedValue({ hits: 11, blockMsLeft: 1000 });
      await expect(service.completeChallenge(token, codeNow())).rejects.toThrow(
        HttpException,
      );
      expect(selectBuilder.getOne).not.toHaveBeenCalled();
    });

    it('rejects an unknown challenge', async () => {
      await expect(
        service.completeChallenge('nope', codeNow()),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a deactivated admin', async () => {
      admin = { ...enabledAdmin(), isActive: false };
      const token = await service.createChallenge('a1');
      await expect(service.completeChallenge(token, codeNow())).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('opting in', () => {
    beforeEach(() => {
      admin = {
        ...enabledAdmin(),
        twoFactorEnabledAt: null,
        twoFactorSecret: null,
      };
    });

    it('asks for the password before showing a secret', async () => {
      (argon2.verify as jest.Mock).mockResolvedValue(false);
      await expect(service.startSetup('a1', 'bad')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockCache.setGlobal).not.toHaveBeenCalled();
    });

    it('stays off until the first code is confirmed, then gives ten backup codes', async () => {
      const { secret, otpauthUrl } = await service.startSetup('a1', 'pw');
      expect(otpauthUrl).toContain(`secret=${secret}`);
      expect(mockRepo.update).not.toHaveBeenCalled();

      const { backupCodes } = await service.enable(
        'a1',
        totpAt(secret, stepNow()),
      );

      expect(backupCodes).toHaveLength(10);
      expect(new Set(backupCodes).size).toBe(10);
      expect(backupCodes[0]).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
      const saved = mockRepo.update.mock.calls[0][1];
      expect(saved.twoFactorSecret).toBe(`enc:${secret}`);
      expect(saved.twoFactorEnabledAt).toBeInstanceOf(Date);
      expect(mockRepo.update).toHaveBeenCalledWith('a1', {
        sessionsValidFrom: expect.any(Date),
      });
      expect(saved.twoFactorBackupCodes).not.toContain(backupCodes[0]);
      expect(mockUtility.sendEmailWithTemplate).toHaveBeenCalledTimes(1);
    });

    it('refuses a wrong first code', async () => {
      const { secret } = await service.startSetup('a1', 'pw');
      const good = totpAt(secret, stepNow());
      await expect(
        service.enable('a1', good === '000000' ? '111111' : '000000'),
      ).rejects.toThrow(BadRequestException);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('asks to start again when setup timed out', async () => {
      await expect(service.enable('a1', '123456')).rejects.toThrow('timed out');
    });
  });

  describe('turning it off', () => {
    it('needs the password and a code', async () => {
      (argon2.verify as jest.Mock).mockResolvedValue(false);
      await expect(service.disable('a1', 'bad', codeNow())).rejects.toThrow(
        BadRequestException,
      );
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('clears everything and tells the admin', async () => {
      await service.disable('a1', 'pw', codeNow());
      expect(mockRepo.update).toHaveBeenCalledWith('a1', {
        twoFactorSecret: null,
        twoFactorEnabledAt: null,
        twoFactorLastStep: null,
        twoFactorBackupCodes: null,
        twoFactorDevicesValidFrom: null,
      });
      expect(mockUtility.sendEmailWithTemplate).toHaveBeenCalledTimes(1);
    });
  });

  describe('remembered devices', () => {
    const cookies = (c: { name: string; value: string }) => ({
      [c.name]: c.value,
    });

    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      jest.setSystemTime(new Date('2026-10-30T10:00:00Z'));
    });
    afterEach(() => jest.useRealTimers());

    it('recognises a remembered device', async () => {
      const c = await service.rememberDevice('a1');
      expect(c.maxAge).toBe(30 * 86_400_000);
      await expect(service.isRememberedDevice('a1', cookies(c))).resolves.toBe(
        true,
      );
    });

    it("asks again with no cookie, and doesn't query the database for it", async () => {
      await expect(service.isRememberedDevice('a1', {})).resolves.toBe(false);
      await expect(service.isRememberedDevice('a1')).resolves.toBe(false);
      expect(selectBuilder.getOne).not.toHaveBeenCalled();
    });

    it('asks again on a tampered cookie', async () => {
      const c = await service.rememberDevice('a1');
      mockEncryption.decrypt.mockImplementationOnce(() => {
        throw new Error('bad auth tag');
      });
      await expect(service.isRememberedDevice('a1', cookies(c))).resolves.toBe(
        false,
      );
    });

    it('asks again after 30 days', async () => {
      const c = await service.rememberDevice('a1');
      jest.setSystemTime(new Date('2026-11-29T10:00:01Z'));
      await expect(service.isRememberedDevice('a1', cookies(c))).resolves.toBe(
        false,
      );
    });

    it('asks again after a password change', async () => {
      const c = await service.rememberDevice('a1');
      admin = { ...enabledAdmin(), passwordHash: 'new-hash' };
      await expect(service.isRememberedDevice('a1', cookies(c))).resolves.toBe(
        false,
      );
    });

    it('asks again once 2FA was turned off and on again', async () => {
      const c = await service.rememberDevice('a1');
      admin = {
        ...enabledAdmin(),
        twoFactorEnabledAt: new Date(Date.now() + 1),
      };
      await expect(service.isRememberedDevice('a1', cookies(c))).resolves.toBe(
        false,
      );
    });

    it("doesn't work for another admin or a deactivated one", async () => {
      const c = await service.rememberDevice('a1');
      await expect(
        service.isRememberedDevice('a2', { [c.name]: c.value }),
      ).resolves.toBe(false);
      admin = { ...enabledAdmin(), isActive: false };
      await expect(service.isRememberedDevice('a1', cookies(c))).resolves.toBe(
        false,
      );
    });

    it('forgetting devices ends earlier ones but not newer ones', async () => {
      const old = await service.rememberDevice('a1');
      jest.setSystemTime(new Date('2026-10-30T11:00:00Z'));
      await service.forgetDevices('a1', 'pw', totpAt(SECRET, stepNow()));
      const validFrom =
        mockRepo.update.mock.calls[0][1].twoFactorDevicesValidFrom;
      expect(validFrom).toBeInstanceOf(Date);
      admin = { ...enabledAdmin(), twoFactorDevicesValidFrom: validFrom };

      await expect(
        service.isRememberedDevice('a1', cookies(old)),
      ).resolves.toBe(false);
      const fresh = await service.rememberDevice('a1');
      await expect(
        service.isRememberedDevice('a1', cookies(fresh)),
      ).resolves.toBe(true);
    });
  });

  it('replaces backup codes after confirming', async () => {
    const { backupCodes } = await service.regenerateBackupCodes(
      'a1',
      'pw',
      codeNow(),
    );
    expect(backupCodes).toHaveLength(10);
  });

  it('reports status without secrets', async () => {
    await expect(service.getStatus('a1')).resolves.toEqual({
      enabled: true,
      enabledAt: expect.any(Date),
      backupCodesRemaining: 1,
    });
  });

  it('a reset by another admin clears it and tells the admin', async () => {
    await service.resetByAnotherAdmin('a1', 'a2');
    expect(mockRepo.update).toHaveBeenCalledWith('a1', {
      sessionsValidFrom: expect.any(Date),
    });
    expect(mockEvents.insert).toHaveBeenCalledWith({
      platformAdminId: 'a1',
      action: 'RESET',
      actorId: 'a2',
    });
    expect(mockRepo.update).toHaveBeenCalled();
    expect(mockUtility.sendEmailWithTemplate).toHaveBeenCalledWith(
      'a@example.com',
      expect.stringContaining('reset'),
      'platform-admin-security-notice',
      expect.anything(),
    );
  });
});
