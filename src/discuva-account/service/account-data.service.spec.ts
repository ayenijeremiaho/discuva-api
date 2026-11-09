import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { AccountDataService } from './account-data.service';
import { DiscuvaAccountService } from './discuva-account.service';
import { DiscuvaProfileService } from './discuva-profile.service';
import { DiscuvaMilestone } from '../entity/discuva-milestone.entity';
import { Member } from '../../member/entity/member.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { PdfService } from '../../utility/service/pdf.service';
import {
  MilestoneSource,
  MilestoneType,
  MilestoneVisibility,
} from '../enum/milestone.enum';

const milestoneRepo = { find: jest.fn() };
const tenantRepo = { find: jest.fn() };
const memberRepo = { findOne: jest.fn() };
const accounts = { findById: jest.fn(), linksOf: jest.fn() };
const profiles = { ownerOf: jest.fn(), ensure: jest.fn() };
const pdfService = {
  generateAccountData: jest.fn().mockResolvedValue(Buffer.from('%PDF')),
};
const config = { get: jest.fn(() => 'Africa/Lagos') };

describe('AccountDataService', () => {
  let service: AccountDataService;

  beforeEach(async () => {
    jest.clearAllMocks();
    memberRepo.findOne.mockResolvedValue({
      id: 'm1',
      discuvaAccountId: 'acc-1',
    });
    profiles.ownerOf.mockResolvedValue('acc-1');
    accounts.findById.mockResolvedValue({
      id: 'acc-1',
      email: 'ada@example.com',
      createdAt: new Date('2026-11-09'),
      password: 'never-shared',
    });
    profiles.ensure.mockResolvedValue({
      accountId: 'acc-1',
      firstname: 'Ada',
      lastname: 'Okafor',
      phoneNumber: '+2348012345678',
      birthDay: 14,
      birthMonth: 3,
      birthYear: 1990,
      gender: 'FEMALE',
      maritalStatus: 'MARRIED',
      address: '12 Example Street',
      emergencyContactName: 'Chidi Okafor',
      emergencyContactPhone: '+2348098765432',
      emergencyContactRelationship: 'Husband',
      photoUrl: null,
      photoPublicId: 'accounts/acc-1/x',
      appearanceMode: 'DARK',
      mutedNotifications: [],
    });
    milestoneRepo.find.mockResolvedValue([
      {
        type: MilestoneType.BAPTISM,
        title: null,
        month: 6,
        year: 2010,
        placeName: 'Sample Church',
        source: MilestoneSource.CHURCH,
        sourceName: 'Sample Church',
        visibility: MilestoneVisibility.CHURCHES,
        hidden: true,
      },
    ]);
    accounts.linksOf.mockResolvedValue([
      { tenantId: 't1', linkedAt: new Date('2026-01-10') },
    ]);
    tenantRepo.find.mockResolvedValue([{ id: 't1', name: 'Sample Church' }]);
    const module = await Test.createTestingModule({
      providers: [
        AccountDataService,
        {
          provide: getRepositoryToken(DiscuvaMilestone),
          useValue: milestoneRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        { provide: getRepositoryToken(Member), useValue: memberRepo },
        { provide: DiscuvaAccountService, useValue: accounts },
        { provide: DiscuvaProfileService, useValue: profiles },
        { provide: PdfService, useValue: pdfService },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(AccountDataService);
  });

  it('holds the profile, milestones and churches, never file ids or passwords', async () => {
    const data = await service.export('m1');

    expect(data.account).toEqual({
      email: 'ada@example.com',
      createdAt: new Date('2026-11-09'),
    });
    expect(data.profile).toMatchObject({
      firstname: 'Ada',
      address: '12 Example Street',
    });
    expect(data.profile).not.toHaveProperty('photoPublicId');
    expect(data.profile).not.toHaveProperty('accountId');
    expect(data.milestones).toEqual([
      {
        type: 'Baptism',
        title: null,
        month: 6,
        year: 2010,
        where: 'Sample Church',
        recordedBy: 'Sample Church',
        visibility: MilestoneVisibility.CHURCHES,
        hidden: true,
      },
    ]);
    expect(data.churches).toEqual([
      { name: 'Sample Church', linkedAt: new Date('2026-01-10') },
    ]);
    expect(JSON.stringify(data)).not.toContain('never-shared');
  });

  it('lays the same out readably for the PDF', async () => {
    await service.pdf('m1');
    const doc = pdfService.generateAccountData.mock.calls[0][0];
    expect(doc.profile).toEqual(
      expect.arrayContaining([
        ['Birthday', '14 Mar 1990'],
        ['Marital status', 'Married'],
        ['Emergency contact', 'Chidi Okafor (Husband) +2348098765432'],
      ]),
    );
    expect(doc.milestones).toEqual([
      {
        when: 'Jun 2010',
        what: 'Baptism',
        where: 'Sample Church',
        recordedBy: 'Sample Church',
        shownTo: 'Your churches (hidden)',
      },
    ]);
  });

  it('is only there once Global Profile is on', async () => {
    profiles.ownerOf.mockResolvedValue(null);
    await expect(service.export('m1')).rejects.toThrow(NotFoundException);
  });
});
