import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { EmailAllowanceService } from './email-allowance.service';
import { CacheService } from './cache.service';
import { TenantVerificationService } from './tenant-verification.service';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { EmailCredentialResolverService } from '../../communication-provider/service/email-credential-resolver.service';
import { EmailCategory } from '../email-provider/email-category.enum';

let count = 0;
const mockCache = {
  incr: jest.fn(async () => ++count),
};
const mockVerification = { isVerified: jest.fn() };
const mockCredentials = { resolveConfig: jest.fn() };
const cls = { get: jest.fn().mockReturnValue('t1') };

describe('EmailAllowanceService', () => {
  let service: EmailAllowanceService;

  beforeEach(async () => {
    jest.clearAllMocks();
    count = 0;
    cls.get.mockReturnValue('t1');
    mockVerification.isVerified.mockResolvedValue(false);
    mockCredentials.resolveConfig.mockResolvedValue(null);
    const module = await Test.createTestingModule({
      providers: [
        EmailAllowanceService,
        { provide: ClsService, useValue: cls },
        { provide: CacheService, useValue: mockCache },
        { provide: TenantVerificationService, useValue: mockVerification },
        {
          provide: PlatformSettingsService,
          useValue: { getNumber: async () => 3 },
        },
        { provide: EmailCredentialResolverService, useValue: mockCredentials },
      ],
    }).compile();
    service = module.get(EmailAllowanceService);
  });

  it('stops an unverified account at its daily limit', async () => {
    const category = EmailCategory.BIRTHDAY;
    await expect(service.allows(category, 3)).resolves.toBe(true);
    await expect(service.allows(category, 1)).resolves.toBe(false);
  });

  it('counts each recipient', async () => {
    await expect(service.allows(EmailCategory.BIRTHDAY, 4)).resolves.toBe(
      false,
    );
  });

  it.each([EmailCategory.LOGIN_ALERT, EmailCategory.GIVING_RECEIPT])(
    'always sends %s',
    async (category) => {
      count = 100;
      await expect(service.allows(category, 1)).resolves.toBe(true);
    },
  );

  it("doesn't limit a verified account", async () => {
    mockVerification.isVerified.mockResolvedValue(true);
    await expect(service.allows(EmailCategory.BIRTHDAY, 50)).resolves.toBe(
      true,
    );
    expect(mockCache.incr).not.toHaveBeenCalled();
  });

  it("doesn't limit a church using its own email provider", async () => {
    mockCredentials.resolveConfig.mockResolvedValue({ providerId: 'smtp' });
    await expect(service.allows(EmailCategory.BIRTHDAY, 50)).resolves.toBe(
      true,
    );
  });

  it('ignores emails outside any church', async () => {
    cls.get.mockReturnValue(undefined);
    await expect(service.allows(EmailCategory.BIRTHDAY, 50)).resolves.toBe(
      true,
    );
  });
});
