import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AdminTwoFactorService } from './admin-two-factor.service';
import { Admin } from '../entity/admin.entity';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { CacheService } from '../../utility/service/cache.service';
import { EncryptionService } from '../../utility/service/encryption.service';
import { UtilityService } from '../../utility/service/utility.service';
import { totpAt } from '../../utility/two-factor/totp';

jest.mock('argon2');

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const codeNow = () => totpAt(SECRET, Math.floor(Date.now() / 30_000));

const scoped = new Map<string, unknown>();
const mockCache = {
  get: jest.fn(async (k: string) => scoped.get(k)),
  set: jest.fn(async (k: string, v: unknown) => {
    scoped.set(k, v);
  }),
  del: jest.fn(async (k: string) => (scoped.delete(k) ? 1 : 0)),
  getGlobal: jest.fn(),
  setGlobal: jest.fn(),
  delGlobal: jest.fn().mockResolvedValue(0),
  hitWindow: jest.fn().mockResolvedValue({ hits: 1, blockMsLeft: 0 }),
};
let admin: Partial<Admin> | null;
const selectBuilder = {
  innerJoinAndSelect: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  getOne: jest.fn(async () => admin),
};
const updateBuilder = {
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue({ affected: 1 }),
};
const mockRepo = {
  update: jest.fn(),
  createQueryBuilder: jest.fn((alias?: string) =>
    alias ? selectBuilder : updateBuilder,
  ),
};
const mockUtility = {
  sendEmailWithTemplate: jest.fn(),
  resolveChurchName: jest.fn().mockResolvedValue('Grace'),
};
const mockAudit = { log: jest.fn() };

const enabledAdmin = (status = MemberStatusEnum.ACTIVE, isActive = true) =>
  ({
    id: 'admin-1',
    isActive,
    twoFactorEnabledAt: new Date(),
    twoFactorSecret: `enc:${SECRET}`,
    twoFactorBackupCodes: ['x'],
    member: {
      id: 'member-1',
      email: 'a@example.com',
      firstname: 'ada',
      password: 'hash',
      status,
    },
  }) as unknown as Admin;

describe('AdminTwoFactorService', () => {
  let service: AdminTwoFactorService;

  beforeEach(async () => {
    jest.clearAllMocks();
    scoped.clear();
    admin = enabledAdmin();
    (argon2.verify as jest.Mock).mockResolvedValue(true);
    const module = await Test.createTestingModule({
      providers: [
        AdminTwoFactorService,
        { provide: getRepositoryToken(Admin), useValue: mockRepo },
        { provide: CacheService, useValue: mockCache },
        {
          provide: EncryptionService,
          useValue: {
            encrypt: (v: string) => `enc:${v}`,
            decrypt: (v: string) => v.replace('enc:', ''),
          },
        },
        { provide: UtilityService, useValue: mockUtility },
        { provide: AuditLogService, useValue: mockAudit },
      ],
    }).compile();
    service = module.get(AdminTwoFactorService);
  });

  it("keeps the challenge in the church's own cache scope", async () => {
    await service.createChallenge('member-1');
    expect(mockCache.set).toHaveBeenCalled();
    expect(mockCache.setGlobal).not.toHaveBeenCalled();
  });

  it('completes sign-in with a correct code', async () => {
    const token = await service.createChallenge('member-1');
    await expect(service.completeChallenge(token, codeNow())).resolves.toBe(
      'member-1',
    );
  });

  it.each([
    ['an inactive member', MemberStatusEnum.INACTIVE, true],
    ['revoked admin access', MemberStatusEnum.ACTIVE, false],
  ])('rejects %s', async (_label, status, isActive) => {
    admin = enabledAdmin(status, isActive);
    const token = await service.createChallenge('member-1');
    await expect(service.completeChallenge(token, codeNow())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('names the church in the authenticator app', async () => {
    admin = {
      ...enabledAdmin(),
      twoFactorEnabledAt: null,
      twoFactorSecret: null,
    };
    const { otpauthUrl } = await service.startSetup('member-1', 'pw');
    expect(otpauthUrl).toContain('Grace%20Admin');
  });

  it('updates the admin row, not the member, and emails and logs the change', async () => {
    await service.disable('member-1', 'pw', codeNow());
    expect(mockRepo.update).toHaveBeenCalledWith(
      'admin-1',
      expect.objectContaining({ twoFactorEnabledAt: null }),
    );
    expect(mockUtility.sendEmailWithTemplate).toHaveBeenCalledWith(
      'a@example.com',
      'Two-factor sign-in is off',
      'admin-security-notice',
      expect.anything(),
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      'ADMIN_2FA_DISABLED',
      expect.anything(),
    );
  });

  it('records who reset another admin', async () => {
    await service.resetByAnotherAdmin('member-1', 'actor-1');
    expect(mockAudit.log).toHaveBeenCalledWith('ADMIN_2FA_RESET', {
      actorId: 'actor-1',
      targetId: 'member-1',
    });
    expect(mockAudit.log).toHaveBeenCalledTimes(1);
  });
});
