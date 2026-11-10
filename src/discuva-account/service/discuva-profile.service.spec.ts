import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  DiscuvaProfileService,
  PROFILE_FIELDS,
} from './discuva-profile.service';
import { DiscuvaAccountService } from './discuva-account.service';
import { DiscuvaProfile } from '../entity/discuva-profile.entity';
import { Member } from '../../member/entity/member.entity';
import { DiscuvaMilestone } from '../entity/discuva-milestone.entity';
import { ClsService } from 'nestjs-cls';
import { CloudinaryService } from '../../utility/service/cloudinary.service';

const insert = {
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  orIgnore: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue(undefined),
};
const profileRepo = {
  findOne: jest.fn(),
  findOneOrFail: jest.fn(),
  save: jest.fn(async (p) => p),
  createQueryBuilder: jest.fn(() => insert),
};
const milestoneInsert = {
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  orIgnore: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue(undefined),
};
const milestoneRepo = { createQueryBuilder: jest.fn(() => milestoneInsert) };
const cls = { get: jest.fn(() => 't-here') };
const cloudinary = {
  uploadAccountFile: jest.fn().mockResolvedValue({
    secureUrl: 'https://cdn.example/accounts/acc-1/p.jpg',
    publicId: 'accounts/acc-1/profile-pictures/1',
  }),
  deleteByPublicId: jest.fn(),
};
const memberRepo = {
  findOneOrFail: jest.fn(),
  update: jest.fn().mockResolvedValue({ affected: 1 }),
};
const accounts = {
  isProfileOn: jest.fn(),
  firstChurchRecord: jest.fn(),
  forEachChurchOf: jest.fn(
    async (
      _member: unknown,
      fn: (id: string) => Promise<void>,
      options: { skipCurrent?: boolean } = {},
    ) => {
      if (!options.skipCurrent) await fn('m-here');
      await fn('m-other');
    },
  ),
};

const churchRow = {
  id: 'm-here',
  discuvaAccountId: 'acc-1',
  firstname: 'Ada',
  lastname: 'Okafor',
  phoneNumber: '+2348012345678',
  gender: 'FEMALE',
  birthDay: 14,
  birthMonth: 3,
  birthYear: null,
  maritalStatus: 'MARRIED',
  address: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  emergencyContactRelationship: null,
  photoUrl: 'https://cdn.example/p.jpg',
  appearanceMode: 'DARK',
  mutedNotifications: ['birthday'],
} as unknown as Member;

describe('DiscuvaProfileService', () => {
  let service: DiscuvaProfileService;

  beforeEach(async () => {
    jest.clearAllMocks();
    accounts.isProfileOn.mockResolvedValue(true);
    const module = await Test.createTestingModule({
      providers: [
        DiscuvaProfileService,
        { provide: getRepositoryToken(DiscuvaProfile), useValue: profileRepo },
        { provide: getRepositoryToken(Member), useValue: memberRepo },
        {
          provide: getRepositoryToken(DiscuvaMilestone),
          useValue: milestoneRepo,
        },
        { provide: DiscuvaAccountService, useValue: accounts },
        { provide: ClsService, useValue: cls },
        { provide: CloudinaryService, useValue: cloudinary },
      ],
    }).compile();
    service = module.get(DiscuvaProfileService);
  });

  describe('who owns the basics', () => {
    it('is the account once Global Profile is on', async () => {
      await expect(service.ownerOf(churchRow)).resolves.toBe('acc-1');
    });

    it('stays with the church for members without an account, or while it is off', async () => {
      await expect(
        service.ownerOf({ discuvaAccountId: null }),
      ).resolves.toBeNull();
      accounts.isProfileOn.mockResolvedValue(false);
      await expect(service.ownerOf(churchRow)).resolves.toBeNull();
    });
  });

  it('counts only basics that would really change', () => {
    expect(
      DiscuvaProfileService.changedBasics(churchRow, {
        firstname: 'Ada',
        phoneNumber: '+2348099999999',
        address: null,
        birthYear: undefined,
      }),
    ).toEqual(['phoneNumber']);
  });

  describe('creating the profile', () => {
    it('starts from the full record at the church the person joined first', async () => {
      profileRepo.findOne.mockResolvedValue(null);
      accounts.firstChurchRecord.mockResolvedValue({
        tenantId: 't-first',
        member: churchRow,
      });
      profileRepo.findOneOrFail.mockResolvedValue({ accountId: 'acc-1' });

      await service.ensure({ id: 'm-here', discuvaAccountId: 'acc-1' });

      expect(memberRepo.findOneOrFail).not.toHaveBeenCalled();

      const values = insert.values.mock.calls[0][0];
      for (const f of PROFILE_FIELDS) expect(values[f]).toEqual(churchRow[f]);
      expect(values).toMatchObject({
        accountId: 'acc-1',
        photoUrl: churchRow.photoUrl,
        appearanceMode: 'DARK',
        mutedNotifications: ['birthday'],
      });
      expect(insert.orIgnore).toHaveBeenCalled();
    });

    it("uses this church's full record when no church is linked yet", async () => {
      profileRepo.findOne.mockResolvedValue(null);
      accounts.firstChurchRecord.mockResolvedValue(null);
      memberRepo.findOneOrFail.mockResolvedValue(churchRow);
      profileRepo.findOneOrFail.mockResolvedValue({ accountId: 'acc-1' });

      await service.ensure({ id: 'm-here', discuvaAccountId: 'acc-1' });

      expect(memberRepo.findOneOrFail).toHaveBeenCalledWith({
        where: { id: 'm-here' },
      });
      expect(insert.values.mock.calls[0][0].phoneNumber).toBe(
        churchRow.phoneNumber,
      );
    });

    it("turns the years given to the church into the person's own milestones", async () => {
      profileRepo.findOne.mockResolvedValue(null);
      accounts.firstChurchRecord.mockResolvedValue(null);
      memberRepo.findOneOrFail.mockResolvedValue({
        ...churchRow,
        yearBornAgain: '2008-01-01',
        yearBaptized: null,
      });
      profileRepo.findOneOrFail.mockResolvedValue({ accountId: 'acc-1' });

      await service.ensure({ id: 'm-here', discuvaAccountId: 'acc-1' });

      expect(milestoneInsert.values).toHaveBeenCalledWith([
        {
          accountId: 'acc-1',
          type: 'SALVATION',
          year: 2008,
          source: 'MEMBER',
          sourceTenantId: 't-here',
          sourceRef: 'import:salvation',
        },
      ]);
      expect(milestoneInsert.orIgnore).toHaveBeenCalled();
    });

    it('reuses an existing profile', async () => {
      profileRepo.findOne.mockResolvedValue({ accountId: 'acc-1' });
      await service.ensure(churchRow);
      expect(insert.execute).not.toHaveBeenCalled();
      expect(memberRepo.findOneOrFail).not.toHaveBeenCalled();
    });
  });

  describe('saving a change', () => {
    beforeEach(() =>
      profileRepo.findOne.mockResolvedValue({
        accountId: 'acc-1',
        firstname: 'Ada',
      }),
    );

    it("writes the profile and every church's copy", async () => {
      await service.update(churchRow, { firstname: 'Adaeze' });

      expect(profileRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ firstname: 'Adaeze' }),
      );
      expect(memberRepo.update.mock.calls).toEqual([
        ['m-here', { firstname: 'Adaeze' }],
        ['m-other', { firstname: 'Adaeze' }],
      ]);
    });

    it("can leave this church's copy to the caller, who has already saved it", async () => {
      await service.update(
        churchRow,
        { address: '12 Example Street' },
        { skipCurrent: true },
      );
      expect(memberRepo.update.mock.calls).toEqual([
        ['m-other', { address: '12 Example Street' }],
      ]);
    });

    it('does nothing for an empty change', async () => {
      await service.update(churchRow, {});
      expect(profileRepo.save).not.toHaveBeenCalled();
      expect(memberRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('lining up a church copy with the profile', () => {
    const profile = () => ({
      accountId: 'acc-1',
      firstname: 'Ada',
      lastname: 'Okafor',
      phoneNumber: '+2348012345678',
      address: null,
      maritalStatus: 'MARRIED',
    });
    const here = () =>
      ({
        id: 'm-here',
        discuvaAccountId: 'acc-1',
        firstname: 'Ada',
        lastname: 'Okafor',
        phoneNumber: '+2348099999999',
        address: '12 Example Street',
        maritalStatus: null,
      }) as unknown as Member;

    it('fills gaps on either side and leaves real differences to the person', async () => {
      profileRepo.findOne.mockResolvedValue(profile());
      const member = here();

      const conflicts = await service.reconcile(member);

      expect(conflicts).toEqual([
        {
          field: 'phoneNumber',
          yours: '+2348012345678',
          here: '+2348099999999',
        },
      ]);
      expect(profileRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ address: '12 Example Street' }),
      );
      expect(memberRepo.update).toHaveBeenCalledWith('m-here', {
        maritalStatus: 'MARRIED',
      });
      expect(member.maritalStatus).toBe('MARRIED');
    });

    it('writes the chosen value everywhere', async () => {
      profileRepo.findOne.mockResolvedValue(profile());

      await service.resolve(here(), { phoneNumber: 'HERE' });

      expect(profileRepo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ phoneNumber: '+2348099999999' }),
      );
      expect(memberRepo.update).toHaveBeenCalledWith('m-other', {
        phoneNumber: '+2348099999999',
      });
    });

    it('needs a choice for every difference', async () => {
      profileRepo.findOne.mockResolvedValue(profile());
      await expect(service.resolve(here(), {})).rejects.toThrow(
        'Please choose which details are right.',
      );
    });
  });

  describe('the profile photo', () => {
    beforeEach(() =>
      profileRepo.findOne.mockResolvedValue({
        accountId: 'acc-1',
        photoUrl: 'https://cdn.example/accounts/acc-1/old.jpg',
        photoPublicId: 'accounts/acc-1/profile-pictures/old',
      }),
    );
    const holder = {
      id: 'm-here',
      discuvaAccountId: 'acc-1',
      photoPublicId: 'tenants/t-here/profile-pictures/older',
    };

    it("goes in the account's own folder and every church shows it", async () => {
      await service.setPhoto(holder, {
        buffer: Buffer.from('x'),
        mimetype: 'image/jpeg',
      });

      expect(cloudinary.uploadAccountFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        'acc-1',
        'profile-pictures',
        'image/jpeg',
      );
      expect(profileRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          photoUrl: 'https://cdn.example/accounts/acc-1/p.jpg',
          photoPublicId: 'accounts/acc-1/profile-pictures/1',
        }),
      );
      const churchCopy = {
        photoUrl: 'https://cdn.example/accounts/acc-1/p.jpg',
        photoPublicId: null,
      };
      expect(memberRepo.update.mock.calls).toEqual([
        ['m-here', churchCopy],
        ['m-other', churchCopy],
      ]);
      expect(cloudinary.deleteByPublicId.mock.calls).toEqual([
        ['accounts/acc-1/profile-pictures/old', 'image'],
        ['tenants/t-here/profile-pictures/older', 'image'],
      ]);
    });

    it('is removed everywhere at once', async () => {
      await service.clearPhoto(holder);
      expect(memberRepo.update).toHaveBeenCalledWith('m-other', {
        photoUrl: null,
        photoPublicId: null,
      });
      expect(cloudinary.uploadAccountFile).not.toHaveBeenCalled();
    });
  });
});
