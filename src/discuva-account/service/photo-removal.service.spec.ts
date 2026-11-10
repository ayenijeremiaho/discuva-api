import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { PhotoRemovalService } from './photo-removal.service';
import { DiscuvaProfileService } from './discuva-profile.service';
import { DiscuvaAccountService } from './discuva-account.service';
import { DiscuvaPhotoRemoval } from '../entity/discuva-photo-removal.entity';
import { PhotoRemovalReason } from '../enum/photo-removal-reason.enum';
import { UtilityService } from '../../utility/service/utility.service';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { Member } from '../../member/entity/member.entity';

const removalRepo = { insert: jest.fn(), count: jest.fn() };
const dataSource = { query: jest.fn() };
const profiles = {
  ownerOf: jest.fn(),
  clearPhoto: jest.fn().mockResolvedValue(undefined),
};
const accounts = {
  findById: jest.fn().mockResolvedValue({ email: 'ada@example.com' }),
};
const utility = { sendEmailWithTemplate: jest.fn() };
const settings = {
  getNumber: jest.fn(async (key: string) =>
    key === 'photo_report_removals' ? 3 : 90,
  ),
};
const cls = { get: jest.fn(() => 't-here') };

const member = {
  id: 'm1',
  firstname: 'ada',
  discuvaAccountId: 'acc-1',
  photoPublicId: null,
} as unknown as Member;

describe('PhotoRemovalService', () => {
  let service: PhotoRemovalService;

  beforeEach(async () => {
    jest.clearAllMocks();
    profiles.ownerOf.mockResolvedValue('acc-1');
    removalRepo.count.mockResolvedValue(1);
    const module = await Test.createTestingModule({
      providers: [
        PhotoRemovalService,
        {
          provide: getRepositoryToken(DiscuvaPhotoRemoval),
          useValue: removalRepo,
        },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: DiscuvaProfileService, useValue: profiles },
        { provide: DiscuvaAccountService, useValue: accounts },
        { provide: UtilityService, useValue: utility },
        { provide: PlatformSettingsService, useValue: settings },
        { provide: ClsService, useValue: cls },
      ],
    }).compile();
    service = module.get(PhotoRemovalService);
  });

  it('removes the photo everywhere, logs who and why, and tells the person', async () => {
    await service.remove(
      member,
      'admin-m1',
      PhotoRemovalReason.SOMEONE_ELSE,
      '  It shows a celebrity. ',
    );

    expect(profiles.clearPhoto).toHaveBeenCalledWith(member);
    expect(removalRepo.insert).toHaveBeenCalledWith({
      accountId: 'acc-1',
      tenantId: 't-here',
      adminId: 'admin-m1',
      reason: PhotoRemovalReason.SOMEONE_ELSE,
      note: 'It shows a celebrity.',
    });
    expect(utility.sendEmailWithTemplate).toHaveBeenCalledWith(
      'ada@example.com',
      'Ada, Your Profile Photo Was Removed',
      'discuva-photo-removed',
      {
        name: 'Ada',
        reason: 'it shows someone else',
        note: 'It shows a celebrity.',
      },
    );
  });

  it('counts removals over the report window', async () => {
    removalRepo.count.mockResolvedValue(3);
    await service.remove(
      member,
      'admin-m1',
      PhotoRemovalReason.OFFENSIVE,
      null,
    );
    expect(removalRepo.count).toHaveBeenCalledWith({
      where: { accountId: 'acc-1', createdAt: expect.anything() },
    });
  });

  it('lists people past the threshold for Discuva staff', async () => {
    dataSource.query.mockResolvedValue([
      {
        account_id: 'acc-1',
        email: 'ada@example.com',
        firstname: 'Ada',
        lastname: 'Okafor',
        removals: '3',
        last_removed_at: new Date('2026-11-10'),
        churches: ['Sample Church'],
      },
    ]);

    await expect(service.reports()).resolves.toEqual([
      {
        accountId: 'acc-1',
        email: 'ada@example.com',
        name: 'Ada Okafor',
        removals: 3,
        lastRemovedAt: new Date('2026-11-10'),
        churches: ['Sample Church'],
      },
    ]);
    expect(dataSource.query.mock.calls[0][1][1]).toBe(3);
  });
});
