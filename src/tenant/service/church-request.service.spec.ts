import { ProtectedNameService } from '../../protected-name/protected-name.service';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ChurchRequestService } from './church-request.service';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { Tenant } from '../entity/tenant.entity';
import { OrganisationTypeEnum } from '../enum/organisation-type.enum';
import { TenantOnboardingStatus } from '../enum/tenant-onboarding-status.enum';
import { TenantVerificationStatus } from '../enum/tenant-verification-status.enum';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { EncryptionService } from '../../utility/service/encryption.service';
import { TenantVerificationService } from '../../utility/service/tenant-verification.service';
import { UtilityService } from '../../utility/service/utility.service';

const execute = jest.fn().mockResolvedValue({ affected: 1 });
const updateBuilder = {
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  execute,
};
const selectBuilder = {
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
};
const mockRepo = {
  update: jest.fn().mockResolvedValue({ affected: 1 }),
  findOneBy: jest.fn(),
  findOneByOrFail: jest.fn(),
  createQueryBuilder: jest.fn((alias?: string) =>
    alias ? selectBuilder : updateBuilder,
  ),
};
const mockProvisioning = {
  recordEvent: jest.fn(),
  holdForApproval: jest.fn(),
  enqueueProvisioning: jest.fn(),
};
const mockSettings = {
  getSelfServeRequiresApproval: jest.fn(),
  getNumber: jest.fn().mockResolvedValue(24),
};
const mockUtility = { sendEmailWithTemplate: jest.fn() };
const mockVerification = { clear: jest.fn() };
const encryption = {
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => {
    if (!v.startsWith('enc:')) throw new Error('bad');
    return v.slice(4);
  },
};

const dto = {
  churchName: 'Hope Assembly',
  subdomain: 'hope',
  adminFirstname: 'Ada',
  adminLastname: 'Obi',
  adminEmail: 'ada@example.com',
};
const details = { adminEmail: 'ada@example.com' };
const tenantWith = (over: object = {}) =>
  ({
    id: 't1',
    name: 'Hope Assembly',
    subdomain: 'hope',
    orgType: OrganisationTypeEnum.CHURCH,
    onboardingStatus: TenantOnboardingStatus.AWAITING_CONFIRMATION,
    verificationStatus: TenantVerificationStatus.NONE,
    verifiedAt: null,
    requestDetails: details,
    pendingSignupParams: {
      adminFirstname: 'Ada',
      adminLastname: 'Obi',
      adminEmail: 'ada@example.com',
      planId: 'free',
    },
    ...over,
  }) as unknown as Tenant;

function tokenFor(email: string, over: object = {}): string {
  return Buffer.from(
    encryption.encrypt(
      JSON.stringify({
        purpose: 'church-request',
        tenantId: 't1',
        email,
        expiresAt: Date.now() + 60_000,
        ...over,
      }),
    ),
  ).toString('base64url');
}

const verificationDto = {
  website: 'hope.example',
  contactEmail: 'office@hope.example',
  seniorLeader: 'Rev. Sam',
  requesterRole: 'Administrator',
};

const mockProtectedNames = {
  findNameMatch: jest.fn().mockResolvedValue(null),
  isReservedAddress: jest.fn().mockResolvedValue(false),
  list: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
};

describe('ChurchRequestService', () => {
  let service: ChurchRequestService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRepo.update.mockResolvedValue({ affected: 1 });
    selectBuilder.getMany.mockResolvedValue([]);
    mockSettings.getSelfServeRequiresApproval.mockResolvedValue(false);
    const module = await Test.createTestingModule({
      providers: [
        {
          provide: ProtectedNameService,
          useValue: mockProtectedNames,
        },
        ChurchRequestService,
        { provide: getRepositoryToken(Tenant), useValue: mockRepo },
        { provide: TenantProvisioningService, useValue: mockProvisioning },
        { provide: PlatformSettingsService, useValue: mockSettings },
        { provide: EncryptionService, useValue: encryption },
        { provide: TenantVerificationService, useValue: mockVerification },
        { provide: UtilityService, useValue: mockUtility },
        {
          provide: ConfigService,
          useValue: { get: () => 'https://discuva.example' },
        },
      ],
    }).compile();
    service = module.get(ChurchRequestService);
  });

  describe('submit', () => {
    it('emails the requester and creates no account yet', async () => {
      await service.submit(tenantWith({ onboardingStatus: 'PENDING' }), {
        ...dto,
        orgType: OrganisationTypeEnum.GROUP,
      });

      expect(mockRepo.update.mock.calls[0][1].onboardingStatus).toBe(
        TenantOnboardingStatus.AWAITING_CONFIRMATION,
      );
      expect(mockUtility.sendEmailWithTemplate).toHaveBeenCalledTimes(1);
      expect(mockProvisioning.enqueueProvisioning).not.toHaveBeenCalled();
    });

    it.each([
      undefined,
      OrganisationTypeEnum.CHURCH,
      OrganisationTypeEnum.MINISTRY,
    ])('requires the proof details for %s', async (orgType) => {
      await expect(
        service.submit(tenantWith(), { ...dto, orgType }),
      ).rejects.toThrow(BadRequestException);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('confirms both addresses when a church gives its proof', async () => {
      await service.submit(tenantWith(), {
        ...dto,
        orgType: OrganisationTypeEnum.CHURCH,
        website: 'https://hope.org',
        contactEmail: 'office@hope.org',
        seniorLeader: 'Rev Obi',
        requesterRole: 'Administrator',
        note: 'Listed on Maps',
      });

      expect(mockUtility.sendEmailWithTemplate).toHaveBeenCalledTimes(2);
      expect(mockRepo.update.mock.calls[0][1].requestDetails).toMatchObject({
        contactDomain: 'hope.org',
        note: 'Listed on Maps',
      });
    });

    it("can't replace a confirmed request", async () => {
      await expect(
        service.submit(
          tenantWith({
            onboardingStatus: TenantOnboardingStatus.AWAITING_APPROVAL,
          }),
          dto,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('confirm', () => {
    it('creates a group account straight away', async () => {
      mockRepo.findOneBy.mockResolvedValue(
        tenantWith({
          orgType: OrganisationTypeEnum.GROUP,
          name: 'Friday Prayer',
        }),
      );

      const result = await service.confirm(tokenFor('ada@example.com'));

      expect(result.status).toBe(TenantOnboardingStatus.PENDING);
      expect(mockProvisioning.enqueueProvisioning).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't1',
          adminEmail: 'ada@example.com',
        }),
      );
    });

    it.each([OrganisationTypeEnum.CHURCH, OrganisationTypeEnum.MINISTRY])(
      'holds a %s for review and creates nothing',
      async (orgType) => {
        mockRepo.findOneBy.mockResolvedValue(tenantWith({ orgType }));

        const result = await service.confirm(tokenFor('ada@example.com'));

        expect(result.status).toBe(TenantOnboardingStatus.AWAITING_APPROVAL);
        expect(mockProvisioning.holdForApproval).toHaveBeenCalledTimes(1);
        expect(mockProvisioning.enqueueProvisioning).not.toHaveBeenCalled();
        expect(mockRepo.update).toHaveBeenCalledWith('t1', {
          verificationStatus: TenantVerificationStatus.PENDING,
        });
      },
    );

    it('tells the church address it was confirmed when clicked first', async () => {
      mockRepo.findOneBy.mockResolvedValue(
        tenantWith({
          requestDetails: { ...details, contactEmail: 'office@hope.org' },
        }),
      );

      const result = await service.confirm(tokenFor('office@hope.org'));

      expect(result.status).toBe(TenantOnboardingStatus.AWAITING_CONFIRMATION);
      expect(mockProvisioning.holdForApproval).not.toHaveBeenCalled();
    });

    it('holds a group whose name sounds like a church', async () => {
      mockRepo.findOneBy.mockResolvedValue(
        tenantWith({
          orgType: OrganisationTypeEnum.GROUP,
          name: 'Grace Church',
        }),
      );

      const result = await service.confirm(tokenFor('ada@example.com'));

      expect(result.status).toBe(TenantOnboardingStatus.AWAITING_APPROVAL);
      expect(mockProvisioning.enqueueProvisioning).not.toHaveBeenCalled();
    });

    it('holds a group named like a protected organisation', async () => {
      mockProtectedNames.findNameMatch.mockResolvedValueOnce(
        'Covenant Grace Church of Nations',
      );
      mockRepo.findOneBy.mockResolvedValue(
        tenantWith({
          orgType: OrganisationTypeEnum.GROUP,
          name: 'Covenant Graces of Nations',
        }),
      );

      const result = await service.confirm(tokenFor('ada@example.com'));

      expect(result.status).toBe(TenantOnboardingStatus.AWAITING_APPROVAL);
      expect(mockProvisioning.enqueueProvisioning).not.toHaveBeenCalled();
    });

    it('holds a group for review only when the off switch is used', async () => {
      mockSettings.getSelfServeRequiresApproval.mockResolvedValue(true);
      mockRepo.findOneBy.mockResolvedValue(
        tenantWith({
          orgType: OrganisationTypeEnum.GROUP,
          name: 'Friday Prayer',
        }),
      );

      const result = await service.confirm(tokenFor('ada@example.com'));

      expect(result.status).toBe(TenantOnboardingStatus.AWAITING_APPROVAL);
      expect(mockProvisioning.holdForApproval).toHaveBeenCalledTimes(1);
      expect(mockProvisioning.enqueueProvisioning).not.toHaveBeenCalled();
    });

    it('creates one account when the link is opened twice at once', async () => {
      mockRepo.findOneBy.mockResolvedValue(
        tenantWith({ orgType: OrganisationTypeEnum.GROUP }),
      );
      mockRepo.update.mockResolvedValue({ affected: 0 });

      await service.confirm(tokenFor('ada@example.com'));

      expect(mockProvisioning.enqueueProvisioning).not.toHaveBeenCalled();
    });

    it('changes nothing when opened again later', async () => {
      mockRepo.findOneBy.mockResolvedValue(
        tenantWith({ onboardingStatus: TenantOnboardingStatus.ACTIVE }),
      );
      const result = await service.confirm(tokenFor('ada@example.com'));
      expect(result.status).toBe(TenantOnboardingStatus.ACTIVE);
      expect(mockProvisioning.enqueueProvisioning).not.toHaveBeenCalled();
    });

    it('records a confirmed church address on a live account', async () => {
      mockRepo.findOneBy.mockResolvedValue(
        tenantWith({
          onboardingStatus: TenantOnboardingStatus.ACTIVE,
          requestDetails: { ...details, contactEmail: 'office@hope.example' },
        }),
      );
      await service.confirm(tokenFor('office@hope.example'));
      expect(execute).toHaveBeenCalledTimes(1);
      expect(mockProvisioning.enqueueProvisioning).not.toHaveBeenCalled();
    });

    it.each([
      ['garbage', Buffer.from('nope').toString('base64url')],
      ['expired', tokenFor('ada@example.com', { expiresAt: Date.now() - 1 })],
      ['wrong purpose', tokenFor('ada@example.com', { purpose: 'other' })],
    ])('rejects a %s token', async (_label, token) => {
      await expect(service.confirm(token)).rejects.toThrow(ConflictException);
    });

    it('rejects an address that is not on the request', async () => {
      mockRepo.findOneBy.mockResolvedValue(tenantWith());
      await expect(
        service.confirm(tokenFor('old@example.com')),
      ).rejects.toThrow(ConflictException);
      expect(mockProvisioning.enqueueProvisioning).not.toHaveBeenCalled();
    });
  });

  describe('verification', () => {
    it('marks the request pending and confirms the church address', async () => {
      mockRepo.findOneByOrFail.mockResolvedValue(
        tenantWith({ onboardingStatus: TenantOnboardingStatus.ACTIVE }),
      );

      await service.requestVerification('t1', verificationDto);

      expect(mockRepo.update).toHaveBeenCalledWith('t1', {
        verificationStatus: TenantVerificationStatus.PENDING,
      });
      expect(mockUtility.sendEmailWithTemplate.mock.calls[0][0]).toBe(
        'office@hope.example',
      );
    });

    it("won't ask again once verified", async () => {
      mockRepo.findOneByOrFail.mockResolvedValue(
        tenantWith({ verificationStatus: TenantVerificationStatus.VERIFIED }),
      );
      await expect(
        service.requestVerification('t1', verificationDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('approving sets the date, clears the cache and tells the church', async () => {
      mockRepo.findOneBy.mockResolvedValue(tenantWith());

      await service.decideVerification('t1', true);

      const saved = mockRepo.update.mock.calls[0][1];
      expect(saved.verificationStatus).toBe(TenantVerificationStatus.VERIFIED);
      expect(saved.verifiedAt).toBeInstanceOf(Date);
      expect(mockVerification.clear).toHaveBeenCalledWith('t1');
      expect(mockUtility.sendEmailWithTemplate).toHaveBeenCalledWith(
        'ada@example.com',
        expect.stringContaining('verified'),
        'tenant-verification-result',
        expect.objectContaining({ approved: true }),
      );
    });

    it('declining a held request frees the address to apply again', async () => {
      mockRepo.findOneBy.mockResolvedValue(
        tenantWith({
          onboardingStatus: TenantOnboardingStatus.AWAITING_APPROVAL,
        }),
      );

      await service.decideVerification('t1', false);

      expect(mockRepo.update).toHaveBeenCalledWith('t1', {
        onboardingStatus: TenantOnboardingStatus.AWAITING_CONFIRMATION,
      });
      expect(
        mockUtility.sendEmailWithTemplate.mock.calls[0][3].apply_again,
      ).toBe(true);
    });

    it('marks a held church verified on approval, but not a group', async () => {
      await service.markVerifiedOnApproval(tenantWith());
      expect(mockRepo.update).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({
          verificationStatus: TenantVerificationStatus.VERIFIED,
        }),
      );
      mockRepo.update.mockClear();
      await service.markVerifiedOnApproval(
        tenantWith({ orgType: OrganisationTypeEnum.GROUP }),
      );
      expect(mockRepo.update).toHaveBeenCalledWith('t1', {
        verificationStatus: TenantVerificationStatus.NONE,
      });
    });

    it("won't decline an already verified account", async () => {
      mockRepo.findOneBy.mockResolvedValue(
        tenantWith({ verificationStatus: TenantVerificationStatus.VERIFIED }),
      );

      await expect(service.decideVerification('t1', false)).rejects.toThrow(
        ConflictException,
      );
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('declining removes any verified date', async () => {
      mockRepo.findOneBy.mockResolvedValue(tenantWith());
      await service.decideVerification('t1', false, 'Needs a document');
      const saved = mockRepo.update.mock.calls[0][1];
      expect(saved.verificationStatus).toBe(TenantVerificationStatus.REJECTED);
      expect(saved.verifiedAt).toBeNull();
    });
  });

  it('names the protected organisation a request looks like', async () => {
    mockProtectedNames.findNameMatch.mockResolvedValueOnce(
      'Covenant Grace Church of Nations',
    );
    const review = await service.review({
      id: 't1',
      name: 'Covenant Graces of Nations',
      orgType: OrganisationTypeEnum.GROUP,
      requestDetails: null,
    } as never);
    expect(review.checks.looksLikeProtectedName).toBe(
      'Covenant Grace Church of Nations',
    );
  });

  it('reports the review checks', async () => {
    selectBuilder.getMany.mockResolvedValue([
      { id: 't2', name: 'Hope Assembly', subdomain: 'hope2' },
    ]);
    const review = await service.review(
      tenantWith({
        requestDetails: {
          ...details,
          website: 'hope.example',
          contactEmail: 'office@hope.example',
          contactDomain: 'hope.example',
          contactEmailConfirmedAt: 'now',
        },
      }),
    );
    expect(review.checks).toEqual({
      contactEmailConfirmed: true,
      emailMatchesWebsite: true,
      personalEmail: false,
      socialPageOnly: false,
      groupNamedLikeChurch: false,
      looksLikeProtectedName: null,
      possibleDuplicates: [
        { id: 't2', name: 'Hope Assembly', subdomain: 'hope2' },
      ],
    });
  });
});
