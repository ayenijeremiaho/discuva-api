import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { ChurchRequestService } from './church-request.service';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { Tenant } from '../entity/tenant.entity';
import { OrganisationTypeEnum } from '../enum/organisation-type.enum';
import { TenantOnboardingStatus } from '../enum/tenant-onboarding-status.enum';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { EncryptionService } from '../../utility/service/encryption.service';
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
  getSelfServeAutoApprove: jest.fn(),
};
const mockUtility = { sendEmailWithTemplate: jest.fn() };
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
  contactEmail: 'office@hope.example',
  website: 'hope.example',
};
const details = {
  adminEmail: 'ada@example.com',
  contactEmail: 'office@hope.example',
  contactDomain: 'hope.example',
  website: 'hope.example',
};
const tenantWith = (over: object = {}) =>
  ({
    id: 't1',
    name: 'Hope Assembly',
    subdomain: 'hope',
    orgType: OrganisationTypeEnum.CHURCH,
    onboardingStatus: TenantOnboardingStatus.AWAITING_CONFIRMATION,
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

const confirmed = {
  ...details,
  adminEmailConfirmedAt: 'now',
  contactEmailConfirmedAt: 'now',
};

describe('ChurchRequestService', () => {
  let service: ChurchRequestService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRepo.update.mockResolvedValue({ affected: 1 });
    selectBuilder.getMany.mockResolvedValue([]);
    mockSettings.getSelfServeRequiresApproval.mockResolvedValue(true);
    mockSettings.getSelfServeAutoApprove.mockResolvedValue(false);
    const module = await Test.createTestingModule({
      providers: [
        ChurchRequestService,
        { provide: getRepositoryToken(Tenant), useValue: mockRepo },
        { provide: TenantProvisioningService, useValue: mockProvisioning },
        { provide: PlatformSettingsService, useValue: mockSettings },
        { provide: EncryptionService, useValue: encryption },
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
    it('stores the request and emails both addresses', async () => {
      await service.submit(tenantWith({ onboardingStatus: 'PENDING' }), dto);

      const saved = mockRepo.update.mock.calls[0][1];
      expect(saved.onboardingStatus).toBe(
        TenantOnboardingStatus.AWAITING_CONFIRMATION,
      );
      expect(saved.requestDetails.contactDomain).toBe('hope.example');
      expect(mockUtility.sendEmailWithTemplate).toHaveBeenCalledTimes(2);
      expect(mockProvisioning.enqueueProvisioning).not.toHaveBeenCalled();
    });

    it('emails once when only one address is given', async () => {
      await service.submit(tenantWith({ onboardingStatus: 'PENDING' }), {
        ...dto,
        contactEmail: undefined,
      });
      expect(mockUtility.sendEmailWithTemplate).toHaveBeenCalledTimes(1);
    });

    it('records no contact domain for a personal address', async () => {
      await service.submit(tenantWith({ onboardingStatus: 'PENDING' }), {
        ...dto,
        contactEmail: 'church@gmail.com',
      });
      expect(
        mockRepo.update.mock.calls[0][1].requestDetails.contactDomain,
      ).toBe(null);
    });

    it("can't replace a request already under review", async () => {
      await expect(
        service.submit(
          tenantWith({
            onboardingStatus: TenantOnboardingStatus.AWAITING_APPROVAL,
          }),
          dto,
        ),
      ).rejects.toThrow(ConflictException);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('confirm', () => {
    it('waits for the second address', async () => {
      mockRepo.findOneBy.mockResolvedValue(tenantWith());
      mockRepo.findOneByOrFail.mockResolvedValue(
        tenantWith({
          requestDetails: { ...details, adminEmailConfirmedAt: 'now' },
        }),
      );

      await service.confirm(tokenFor('ada@example.com'));

      expect(mockProvisioning.holdForApproval).not.toHaveBeenCalled();
      expect(mockProvisioning.enqueueProvisioning).not.toHaveBeenCalled();
    });

    it('holds for review once both are confirmed', async () => {
      mockRepo.findOneBy.mockResolvedValue(tenantWith());
      mockRepo.findOneByOrFail.mockResolvedValue(
        tenantWith({ requestDetails: confirmed }),
      );

      const result = await service.confirm(tokenFor('office@hope.example'));

      expect(result.status).toBe(TenantOnboardingStatus.AWAITING_APPROVAL);
      expect(mockProvisioning.holdForApproval).toHaveBeenCalledTimes(1);
      expect(mockProvisioning.enqueueProvisioning).not.toHaveBeenCalled();
    });

    it('tells reviewers once when both confirm together', async () => {
      mockRepo.findOneBy.mockResolvedValue(tenantWith());
      mockRepo.findOneByOrFail.mockResolvedValue(
        tenantWith({ requestDetails: confirmed }),
      );
      mockRepo.update.mockResolvedValue({ affected: 0 });

      await service.confirm(tokenFor('office@hope.example'));

      expect(mockProvisioning.holdForApproval).not.toHaveBeenCalled();
    });

    it('provisions straight away when approval is off', async () => {
      mockSettings.getSelfServeRequiresApproval.mockResolvedValue(false);
      mockRepo.findOneBy.mockResolvedValue(tenantWith());
      mockRepo.findOneByOrFail.mockResolvedValue(
        tenantWith({ requestDetails: confirmed }),
      );

      await service.confirm(tokenFor('office@hope.example'));

      expect(mockProvisioning.enqueueProvisioning).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't1',
          adminEmail: 'ada@example.com',
        }),
      );
    });

    describe('auto-approve', () => {
      beforeEach(() => {
        mockSettings.getSelfServeAutoApprove.mockResolvedValue(true);
        mockRepo.findOneBy.mockResolvedValue(tenantWith());
      });

      it('skips review when every check passes', async () => {
        mockRepo.findOneByOrFail.mockResolvedValue(
          tenantWith({ requestDetails: confirmed }),
        );
        await service.confirm(tokenFor('office@hope.example'));
        expect(mockProvisioning.enqueueProvisioning).toHaveBeenCalled();
        expect(mockProvisioning.holdForApproval).not.toHaveBeenCalled();
      });

      it('still holds a possible duplicate', async () => {
        selectBuilder.getMany.mockResolvedValue([{ id: 't2' }]);
        mockRepo.findOneByOrFail.mockResolvedValue(
          tenantWith({ requestDetails: confirmed }),
        );
        await service.confirm(tokenFor('office@hope.example'));
        expect(mockProvisioning.holdForApproval).toHaveBeenCalled();
      });

      it('still holds a personal email', async () => {
        mockRepo.findOneByOrFail.mockResolvedValue(
          tenantWith({
            requestDetails: { ...confirmed, contactEmail: 'c@gmail.com' },
          }),
        );
        await service.confirm(tokenFor('office@hope.example'));
        expect(mockProvisioning.holdForApproval).toHaveBeenCalled();
      });
    });

    it('changes nothing when a link is opened again later', async () => {
      mockRepo.findOneBy.mockResolvedValue(
        tenantWith({
          onboardingStatus: TenantOnboardingStatus.AWAITING_APPROVAL,
        }),
      );
      const result = await service.confirm(tokenFor('ada@example.com'));
      expect(result.status).toBe(TenantOnboardingStatus.AWAITING_APPROVAL);
      expect(execute).not.toHaveBeenCalled();
    });

    it.each([
      ['garbage', Buffer.from('nope').toString('base64url')],
      ['expired', tokenFor('ada@example.com', { expiresAt: Date.now() - 1 })],
      ['wrong purpose', tokenFor('ada@example.com', { purpose: 'other' })],
    ])('rejects a %s token', async (_label, token) => {
      await expect(service.confirm(token)).rejects.toThrow(ConflictException);
    });

    it('rejects an address that is no longer on the request', async () => {
      mockRepo.findOneBy.mockResolvedValue(tenantWith());
      await expect(
        service.confirm(tokenFor('old@example.com')),
      ).rejects.toThrow(ConflictException);
    });
  });

  it('resends only what is unconfirmed, and only while waiting', async () => {
    mockRepo.findOneBy.mockResolvedValueOnce(
      tenantWith({
        requestDetails: { ...details, adminEmailConfirmedAt: 'now' },
      }),
    );
    await service.resendConfirmations('t1');
    expect(mockUtility.sendEmailWithTemplate).toHaveBeenCalledTimes(1);
    expect(mockUtility.sendEmailWithTemplate.mock.calls[0][0]).toBe(
      'office@hope.example',
    );

    mockUtility.sendEmailWithTemplate.mockClear();
    mockRepo.findOneBy.mockResolvedValueOnce(
      tenantWith({ onboardingStatus: TenantOnboardingStatus.ACTIVE }),
    );
    await service.resendConfirmations('t1');
    expect(mockUtility.sendEmailWithTemplate).not.toHaveBeenCalled();
  });

  it('reports the review checks', async () => {
    selectBuilder.getMany.mockResolvedValue([
      { id: 't2', name: 'Hope Assembly', subdomain: 'hope2' },
    ]);
    const review = await service.review(
      tenantWith({ requestDetails: confirmed }),
    );
    expect(review.checks).toEqual({
      bothEmailsConfirmed: true,
      emailMatchesWebsite: true,
      personalEmail: false,
      socialPageOnly: false,
      possibleDuplicates: [
        { id: 't2', name: 'Hope Assembly', subdomain: 'hope2' },
      ],
    });
  });
});
