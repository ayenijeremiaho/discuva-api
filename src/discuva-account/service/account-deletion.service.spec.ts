import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AccountDeletionService } from './account-deletion.service';
import { DiscuvaAccountService } from './discuva-account.service';
import { DiscuvaAccountCodeService } from './discuva-account-code.service';
import { DiscuvaProfileService } from './discuva-profile.service';
import { DiscuvaAccount } from '../entity/discuva-account.entity';
import { DiscuvaAccountCodePurpose } from '../entity/discuva-account-code.entity';
import { ACCOUNT_DELETION_QUEUE } from '../processor/account-deletion.processor';
import { Member } from '../../member/entity/member.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';

const DAY = 86_400_000;
const accountRepo = { update: jest.fn(), findOne: jest.fn() };
const holderQb = {
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  getOne: jest.fn(),
};
const memberRepo = { createQueryBuilder: jest.fn(() => holderQb) };
const accounts = {
  verifyPassword: jest.fn(),
  findById: jest.fn(),
  erase: jest.fn(),
};
const codes = {
  issueLinkToken: jest.fn().mockResolvedValue('t'.repeat(64)),
  findLinkToken: jest.fn().mockResolvedValue({ id: 'code-1' }),
  markUsed: jest.fn(),
};
const profiles = { ownerOf: jest.fn() };
const utility = {
  sendEmailWithTemplate: jest.fn(),
  resolveMemberUrl: jest.fn(async (p: string) => `https://church.example${p}`),
};
const cloudinary = {
  deleteByPublicId: jest.fn(),
  deleteAccountFiles: jest.fn().mockResolvedValue(undefined),
};
const settings = { getNumber: jest.fn().mockResolvedValue(14) };
const queue = { add: jest.fn() };

const member = { id: 'm1', firstname: 'ada', discuvaAccountId: 'acc-1' };
const account = {
  id: 'acc-1',
  email: 'ada@example.com',
  deleteRequestedAt: null as Date | null,
};

describe('AccountDeletionService', () => {
  let service: AccountDeletionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    holderQb.getOne.mockResolvedValue(member);
    profiles.ownerOf.mockResolvedValue('acc-1');
    accounts.findById.mockResolvedValue({ ...account });
    accounts.verifyPassword.mockResolvedValue(true);
    const module = await Test.createTestingModule({
      providers: [
        AccountDeletionService,
        { provide: getRepositoryToken(DiscuvaAccount), useValue: accountRepo },
        { provide: getRepositoryToken(Member), useValue: memberRepo },
        { provide: DiscuvaAccountService, useValue: accounts },
        { provide: DiscuvaAccountCodeService, useValue: codes },
        { provide: DiscuvaProfileService, useValue: profiles },
        { provide: UtilityService, useValue: utility },
        { provide: CloudinaryService, useValue: cloudinary },
        { provide: PlatformSettingsService, useValue: settings },
        { provide: getQueueToken(ACCOUNT_DELETION_QUEUE), useValue: queue },
      ],
    }).compile();
    service = module.get(AccountDeletionService);
  });

  describe('asking to delete', () => {
    it('needs the password', async () => {
      accounts.verifyPassword.mockResolvedValue(false);
      await expect(service.request('m1', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('waits out the grace period with a delayed job and emails a keep link', async () => {
      const deletesOn = await service.request('m1', 'right');

      const [{ requestedAt }] = accountRepo.update.mock.calls.map(([, v]) => ({
        requestedAt: v.deleteRequestedAt as Date,
      }));
      expect(queue.add).toHaveBeenCalledWith(
        { accountId: 'acc-1', requestedAt: requestedAt.getTime() },
        expect.objectContaining({
          delay: 14 * DAY,
          jobId: `delete:acc-1:${requestedAt.getTime()}`,
        }),
      );
      expect(deletesOn.getTime()).toBe(requestedAt.getTime() + 14 * DAY);
      expect(codes.issueLinkToken).toHaveBeenCalledWith(
        'acc-1',
        DiscuvaAccountCodePurpose.DELETE_CANCEL,
        'ada@example.com',
        14,
      );
      expect(utility.sendEmailWithTemplate).toHaveBeenCalledWith(
        'ada@example.com',
        'Ada, Your Discuva Account Will Be Deleted',
        'discuva-account-deletion',
        expect.objectContaining({
          cancel_url: `https://church.example/account/keep?a=acc-1&t=${'t'.repeat(64)}`,
        }),
      );
    });

    it("won't start twice", async () => {
      accounts.findById.mockResolvedValue({
        ...account,
        deleteRequestedAt: new Date(),
      });
      await expect(service.request('m1', 'right')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  it('can be cancelled from the app or the emailed link', async () => {
    await service.cancel('m1');
    expect(accountRepo.update).toHaveBeenCalledWith('acc-1', {
      deleteRequestedAt: null,
    });

    await service.cancelWithLink('acc-1', 't'.repeat(64));
    expect(codes.findLinkToken).toHaveBeenCalledWith(
      'acc-1',
      DiscuvaAccountCodePurpose.DELETE_CANCEL,
      't'.repeat(64),
    );
    expect(codes.markUsed).toHaveBeenCalledWith('code-1');
  });

  describe('when the job runs', () => {
    const at = new Date('2026-11-10T09:00:00Z');

    it('erases the account and removes its files', async () => {
      accountRepo.findOne.mockResolvedValue({
        id: 'acc-1',
        deleteRequestedAt: at,
      });
      accounts.erase.mockResolvedValue(['tenants/t1/profile-pictures/old']);

      await service.run('acc-1', at.getTime());

      expect(accounts.erase).toHaveBeenCalledWith('acc-1');
      expect(cloudinary.deleteByPublicId).toHaveBeenCalledWith(
        'tenants/t1/profile-pictures/old',
        'image',
      );
      expect(cloudinary.deleteAccountFiles).toHaveBeenCalledWith('acc-1');
    });

    it('does nothing after a cancel, or for an older request', async () => {
      accountRepo.findOne.mockResolvedValueOnce({
        id: 'acc-1',
        deleteRequestedAt: null,
      });
      await service.run('acc-1', at.getTime());

      accountRepo.findOne.mockResolvedValueOnce({
        id: 'acc-1',
        deleteRequestedAt: new Date(at.getTime() + DAY),
      });
      await service.run('acc-1', at.getTime());

      expect(accounts.erase).not.toHaveBeenCalled();
    });
  });

  it('reports when deletion is due', async () => {
    await expect(
      service.scheduledFor({ deleteRequestedAt: new Date(0) }),
    ).resolves.toEqual(new Date(14 * DAY));
    await expect(
      service.scheduledFor({ deleteRequestedAt: null }),
    ).resolves.toBeNull();
  });
});
