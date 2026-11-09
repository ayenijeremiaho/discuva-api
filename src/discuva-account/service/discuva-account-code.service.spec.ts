import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { BadRequestException, HttpException } from '@nestjs/common';
import { DiscuvaAccountCodeService } from './discuva-account-code.service';
import {
  DiscuvaAccountCode,
  DiscuvaAccountCodePurpose,
} from '../entity/discuva-account-code.entity';
import { CacheService } from '../../utility/service/cache.service';
import { UtilityService } from '../../utility/service/utility.service';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';

const codeRepo = {
  delete: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
  findOne: jest.fn(),
  update: jest.fn(),
  createQueryBuilder: jest.fn(),
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
const utility = { sendEmailWithTemplate: jest.fn() };
const SETTINGS: Record<string, number> = {
  account_code_requests_per_hour: 3,
  account_code_max_attempts: 5,
  account_code_ttl_minutes: 10,
  account_link_valid_days: 7,
};
const settings = { getNumber: jest.fn(async (k: string) => SETTINGS[k]) };
const cls = { get: jest.fn(() => 't1') };
const P = DiscuvaAccountCodePurpose.JOIN;
const message = { firstName: 'ada', action: 'You asked to join.' };

describe('DiscuvaAccountCodeService', () => {
  let service: DiscuvaAccountCodeService;

  beforeEach(async () => {
    jest.clearAllMocks();
    counters.clear();
    const module = await Test.createTestingModule({
      providers: [
        DiscuvaAccountCodeService,
        { provide: getRepositoryToken(DiscuvaAccountCode), useValue: codeRepo },
        { provide: CacheService, useValue: cache },
        { provide: UtilityService, useValue: utility },
        { provide: PlatformSettingsService, useValue: settings },
        { provide: ClsService, useValue: cls },
      ],
    }).compile();
    service = module.get(DiscuvaAccountCodeService);
  });

  describe('emailed codes', () => {
    it("replaces only this device's earlier code, keeps just a hash and emails the code", async () => {
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('code-hash');
      await service.sendCode('Ada@Example.com', P, 'phone-123', message);
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
      const [to, , template, data] =
        utility.sendEmailWithTemplate.mock.calls[0];
      expect(to).toBe('ada@example.com');
      expect(template).toBe('discuva-account-code');
      expect(data).toMatchObject({
        name: 'Ada',
        expiresMinutes: '10',
        action: 'You asked to join.',
      });
      expect(data.otp).toMatch(/^\d{6}$/);
      expect(JSON.stringify(codeRepo.save.mock.calls)).not.toContain(data.otp);
    });

    it('limits how many codes one email and device can ask for', async () => {
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('h');
      for (let i = 0; i < 3; i++)
        await service.sendCode('a@b.co', P, 'phone-123', message);
      await expect(
        service.sendCode('a@b.co', P, 'phone-123', message),
      ).rejects.toThrow(HttpException);
      await expect(
        service.sendCode('a@b.co', P, 'other-phone', message),
      ).resolves.toBeUndefined();
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

  describe('security email links', () => {
    it('keeps only a hash of the link token', async () => {
      const token = await service.issueLinkToken(
        'a1',
        DiscuvaAccountCodePurpose.FREEZE,
        'Old@Example.com',
      );
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      const saved = codeRepo.save.mock.calls[0][0];
      expect(saved.codeHash).not.toBe(token);
      expect(saved).toMatchObject({
        accountId: 'a1',
        email: 'old@example.com',
      });
    });

    it('finds a live link without using it up, and refuses a used or expired one', async () => {
      codeRepo.findOne.mockResolvedValueOnce({
        id: 'c1',
        expiresAt: new Date(Date.now() + 1000),
      });
      await expect(
        service.findLinkToken(
          'a1',
          DiscuvaAccountCodePurpose.FREEZE,
          'f'.repeat(64),
        ),
      ).resolves.toMatchObject({ id: 'c1' });
      expect(codeRepo.update).not.toHaveBeenCalled();
      codeRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.findLinkToken('a1', DiscuvaAccountCodePurpose.FREEZE, 'x'),
      ).rejects.toThrow(BadRequestException);
      codeRepo.findOne.mockResolvedValueOnce({
        id: 'c2',
        expiresAt: new Date(Date.now() - 1),
      });
      await expect(
        service.findLinkToken('a1', DiscuvaAccountCodePurpose.FREEZE, 'x'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  it('clears used and expired codes in one statement', async () => {
    const qb = {
      delete: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn(),
    };
    codeRepo.createQueryBuilder.mockReturnValue(qb);
    await service.purge();
    expect(qb.where).toHaveBeenCalledWith(
      'used_at IS NOT NULL OR expires_at < :now',
      { now: expect.any(Date) },
    );
    expect(qb.execute).toHaveBeenCalledTimes(1);
  });
});
