import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MilestoneService } from './milestone.service';
import { DiscuvaProfileService } from './discuva-profile.service';
import { DiscuvaAccountService } from './discuva-account.service';
import { DiscuvaMilestone } from '../entity/discuva-milestone.entity';
import { Member } from '../../member/entity/member.entity';
import { ClassEnrollment } from '../../classes/entity/class-enrollment.entity';
import { UtilityService } from '../../utility/service/utility.service';
import {
  MilestoneSource,
  MilestoneType,
  MilestoneVisibility,
} from '../enum/milestone.enum';

const insert = {
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  orIgnore: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue(undefined),
};
const list = {
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
};
const milestoneRepo = {
  createQueryBuilder: jest.fn(),
  create: jest.fn((v) => ({ ...v })),
  save: jest.fn(async (v) => ({ id: 'ms-new', ...v })),
  findOne: jest.fn(),
  delete: jest.fn(),
};
const memberRepo = {
  findOne: jest.fn(),
  update: jest.fn(),
};
const completions = {
  innerJoin: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getRawMany: jest.fn(),
};
const enrollmentRepo = { createQueryBuilder: jest.fn(() => completions) };
const profiles = {
  ownerOf: jest.fn(),
  writeToChurches: jest.fn().mockResolvedValue(undefined),
};
const accounts = { isProfileOn: jest.fn() };
const utility = {
  resolveChurchName: jest.fn().mockResolvedValue('Sample Church'),
};
const cls = { get: jest.fn(() => 't-here') };

const holder = { id: 'm1', discuvaAccountId: 'acc-1' };
const churchRecorded = {
  id: 'ms-1',
  accountId: 'acc-1',
  type: MilestoneType.MEMBERSHIP_CLASS,
  source: MilestoneSource.CHURCH,
  sourceName: 'Sample Church',
  visibility: MilestoneVisibility.CHURCHES,
  hidden: false,
};

describe('MilestoneService', () => {
  let service: MilestoneService;

  beforeEach(async () => {
    jest.clearAllMocks();
    memberRepo.findOne.mockResolvedValue(holder);
    profiles.ownerOf.mockResolvedValue('acc-1');
    accounts.isProfileOn.mockResolvedValue(true);
    milestoneRepo.createQueryBuilder.mockImplementation((alias?: string) =>
      alias ? list : insert,
    );
    const module = await Test.createTestingModule({
      providers: [
        MilestoneService,
        {
          provide: getRepositoryToken(DiscuvaMilestone),
          useValue: milestoneRepo,
        },
        { provide: getRepositoryToken(Member), useValue: memberRepo },
        {
          provide: getRepositoryToken(ClassEnrollment),
          useValue: enrollmentRepo,
        },
        { provide: DiscuvaProfileService, useValue: profiles },
        { provide: DiscuvaAccountService, useValue: accounts },
        { provide: UtilityService, useValue: utility },
        { provide: ClsService, useValue: cls },
      ],
    }).compile();
    service = module.get(MilestoneService);
  });

  describe("the person's own milestones", () => {
    it('are only there once Global Profile is on', async () => {
      profiles.ownerOf.mockResolvedValue(null);
      await expect(service.listMine('m1')).rejects.toThrow(NotFoundException);
    });

    it("are added as the person's own, and a salvation year reaches every church copy", async () => {
      await service.create('m1', {
        type: MilestoneType.SALVATION,
        year: 2008,
        placeName: 'Youth camp',
      });

      expect(milestoneRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'acc-1',
          source: MilestoneSource.MEMBER,
          visibility: MilestoneVisibility.CHURCHES,
        }),
      );
      expect(profiles.writeToChurches).toHaveBeenCalledWith(holder, {
        yearBornAgain: new Date('2008-01-01'),
      });
    });

    it('need a name for "Other" and a year with a month', async () => {
      await expect(
        service.create('m1', { type: MilestoneType.OTHER }),
      ).rejects.toThrow('Give this milestone a name.');
      await expect(
        service.create('m1', { type: MilestoneType.MARRIAGE, month: 6 }),
      ).rejects.toThrow('Add the year as well as the month.');
    });
  });

  describe('a milestone a church recorded', () => {
    beforeEach(() =>
      milestoneRepo.findOne.mockResolvedValue({ ...churchRecorded }),
    );

    it('can be hidden or made private', async () => {
      await service.update('m1', 'ms-1', {
        hidden: true,
        visibility: MilestoneVisibility.PRIVATE,
      });
      expect(milestoneRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          hidden: true,
          visibility: MilestoneVisibility.PRIVATE,
        }),
      );
    });

    it("can't be changed or deleted by the person", async () => {
      await expect(
        service.update('m1', 'ms-1', { year: 2020 }),
      ).rejects.toThrow(ForbiddenException);
      await expect(service.remove('m1', 'ms-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(milestoneRepo.save).not.toHaveBeenCalled();
      expect(milestoneRepo.delete).not.toHaveBeenCalled();
    });
  });

  it('shows admins only what the person shares with their churches', async () => {
    list.getMany.mockResolvedValue([
      churchRecorded,
      { ...churchRecorded, id: 'ms-2', hidden: true },
      {
        ...churchRecorded,
        id: 'ms-3',
        visibility: MilestoneVisibility.PRIVATE,
      },
    ]);
    const shown = await service.listForChurch('m1');
    expect(shown.map((m) => m.id)).toEqual(['ms-1']);

    profiles.ownerOf.mockResolvedValue(null);
    await expect(service.listForChurch('m1')).resolves.toEqual([]);
  });

  describe('completing a class that counts as a milestone', () => {
    const done = {
      id: 'e1',
      completedAt: new Date('2026-03-15T10:00:00Z'),
      accountId: 'acc-1',
      countsAs: MilestoneType.MEMBERSHIP_CLASS,
      className: 'Membership Class',
    };

    it("records it on the person's profile, once per enrolment", async () => {
      completions.getRawMany.mockResolvedValue([done]);

      await service.recordClassCompletions(['e1', 'e2']);

      expect(insert.values).toHaveBeenCalledWith([
        {
          accountId: 'acc-1',
          type: MilestoneType.MEMBERSHIP_CLASS,
          title: 'Membership Class',
          month: 3,
          year: 2026,
          placeTenantId: 't-here',
          placeName: 'Sample Church',
          source: MilestoneSource.CHURCH,
          sourceTenantId: 't-here',
          sourceName: 'Sample Church',
          sourceRef: 'enrollment:e1',
        },
      ]);
      expect(insert.orIgnore).toHaveBeenCalled();
    });

    it('does nothing while Global Profile is off here, or with nobody to record', async () => {
      completions.getRawMany.mockResolvedValue([done]);
      accounts.isProfileOn.mockResolvedValue(false);
      await service.recordClassCompletions(['e1']);

      await service.recordClassCompletions([]);
      expect(enrollmentRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(insert.execute).not.toHaveBeenCalled();
    });
  });

  describe('an admin recording a baptism', () => {
    it("updates the church record and the person's profile", async () => {
      milestoneRepo.findOne.mockResolvedValue(null);

      await service.recordBaptism('m1', { month: 6, year: 2010 });

      expect(memberRepo.update).toHaveBeenCalledWith('m1', {
        yearBaptized: new Date('2010-01-01'),
      });
      expect(milestoneRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'acc-1',
          type: MilestoneType.BAPTISM,
          month: 6,
          year: 2010,
          source: MilestoneSource.CHURCH,
          sourceRef: 'baptism',
        }),
      );
    });

    it('only updates the church record for someone without a profile', async () => {
      profiles.ownerOf.mockResolvedValue(null);
      await service.recordBaptism('m1', { year: 2010 });
      expect(memberRepo.update).toHaveBeenCalled();
      expect(milestoneRepo.save).not.toHaveBeenCalled();
    });
  });
});
