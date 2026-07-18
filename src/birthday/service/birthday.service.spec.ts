import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BirthdayService } from './birthday.service';
import { BirthdayWish } from '../entity/birthday-wish.entity';
import { Member } from '../../member/entity/member.entity';
import { Announcement } from '../../announcement/entity/announcement.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { SanitizationService } from '../../utility/service/sanitization.service';
import { CacheService } from '../../utility/service/cache.service';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { AnnouncementAudienceEnum } from '../../announcement/enum/announcement-audience.enum';

jest.mock('../../utility/service/sanitization.service', () => ({
  SanitizationService: jest.fn().mockImplementation(() => ({
    sanitize: jest.fn((html: string) => html),
    sanitizeText: jest.fn((text: string) => text),
  })),
}));

const makeQb = () => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
});

const mockWishRepo = {
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue([]),
  create: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockMemberRepo = {
  createQueryBuilder: jest.fn(),
  update: jest.fn().mockResolvedValue(undefined),
  find: jest.fn().mockResolvedValue([]),
};

const mockAnnouncementRepo = {
  create: jest.fn(),
  save: jest.fn(),
};

const mockUtilityService = {
  sendEmailWithTemplate: jest.fn(),
};

const mockSanitizationService = {
  sanitizeText: jest.fn((text: string) => text),
};

const mockCacheService = {
  key: jest.fn((ns: string, id: string) => `${ns}:${id}`),
  get: jest.fn().mockResolvedValue(0),
  set: jest.fn().mockResolvedValue(undefined),
  incr: jest.fn().mockResolvedValue(1),
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn(),
};

const mockConfigService = {
  get: jest.fn(),
};

const makeMember = (overrides: Partial<Member> = {}): Member =>
  ({
    id: 'member-1',
    firstname: 'John',
    lastname: 'Doe',
    email: 'john@example.com',
    status: MemberStatusEnum.ACTIVE,
    ...overrides,
  }) as Member;

describe('BirthdayService', () => {
  let service: BirthdayService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.acquireLock.mockResolvedValue(true);
    mockConfigService.get.mockReturnValue(20);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BirthdayService,
        { provide: getRepositoryToken(BirthdayWish), useValue: mockWishRepo },
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        {
          provide: getRepositoryToken(Announcement),
          useValue: mockAnnouncementRepo,
        },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: SanitizationService, useValue: mockSanitizationService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<BirthdayService>(BirthdayService);
  });

  describe('triggerBirthdayGreetings', () => {
    it('does nothing when no members have a birthday today', async () => {
      const qb = makeQb();
      qb.getMany.mockResolvedValue([]);
      mockMemberRepo.createQueryBuilder.mockReturnValue(qb);

      await service.triggerBirthdayGreetings();

      expect(mockAnnouncementRepo.save).not.toHaveBeenCalled();
      expect(mockUtilityService.sendEmailWithTemplate).not.toHaveBeenCalled();
    });

    it('creates an announcement and sends email for each birthday member', async () => {
      const members = [
        makeMember({ id: 'm1' }),
        makeMember({ id: 'm2', firstname: 'Jane' }),
      ];
      const qb = makeQb();
      qb.getMany.mockResolvedValue(members);
      mockMemberRepo.createQueryBuilder.mockReturnValue(qb);

      const fakeAnnouncement = { id: 'ann-1' };
      mockAnnouncementRepo.create.mockReturnValue(fakeAnnouncement);
      mockAnnouncementRepo.save.mockResolvedValue(fakeAnnouncement);

      await service.triggerBirthdayGreetings();

      expect(mockAnnouncementRepo.create).toHaveBeenCalledTimes(2);
      expect(mockAnnouncementRepo.save).toHaveBeenCalledTimes(2);
      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledTimes(2);
    });

    it('creates an ALL-audience announcement with an expiresAt', async () => {
      const member = makeMember();
      const qb = makeQb();
      qb.getMany.mockResolvedValue([member]);
      mockMemberRepo.createQueryBuilder.mockReturnValue(qb);
      mockAnnouncementRepo.create.mockReturnValue({});
      mockAnnouncementRepo.save.mockResolvedValue({});

      await service.triggerBirthdayGreetings();

      const createCall = mockAnnouncementRepo.create.mock.calls[0][0];
      expect(createCall.audience).toBe(AnnouncementAudienceEnum.ALL);
      expect(createCall.expiresAt).toBeInstanceOf(Date);
      expect(createCall.expiresAt.getHours()).toBe(23);
    });

    it('queries only ACTIVE members not yet greeted this year', async () => {
      const qb = makeQb();
      qb.getMany.mockResolvedValue([]);
      mockMemberRepo.createQueryBuilder.mockReturnValue(qb);

      await service.triggerBirthdayGreetings();

      expect(qb.andWhere).toHaveBeenCalledWith('m.status = :status', {
        status: MemberStatusEnum.ACTIVE,
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(m.birthdayGreetedYear IS NULL OR m.birthdayGreetedYear != :year)',
        { year: new Date().getFullYear() },
      );
    });

    it('sets birthdayGreetedYear after announcement saves successfully', async () => {
      const member = makeMember({ id: 'm1' });
      const qb = makeQb();
      qb.getMany.mockResolvedValue([member]);
      mockMemberRepo.createQueryBuilder.mockReturnValue(qb);
      mockAnnouncementRepo.create.mockReturnValue({});
      mockAnnouncementRepo.save.mockResolvedValue({});

      await service.triggerBirthdayGreetings();

      expect(mockMemberRepo.update).toHaveBeenCalledWith('m1', {
        birthdayGreetedYear: new Date().getFullYear(),
      });
    });

    it('continues to next member when one fails and does not set birthdayGreetedYear for the failed member', async () => {
      const members = [
        makeMember({ id: 'm1' }),
        makeMember({ id: 'm2', firstname: 'Jane' }),
      ];
      const qb = makeQb();
      qb.getMany.mockResolvedValue(members);
      mockMemberRepo.createQueryBuilder.mockReturnValue(qb);
      mockAnnouncementRepo.create.mockReturnValue({});
      mockAnnouncementRepo.save
        .mockRejectedValueOnce(new Error('DB timeout'))
        .mockResolvedValue({});

      await service.triggerBirthdayGreetings();

      expect(mockMemberRepo.update).toHaveBeenCalledTimes(1);
      expect(mockMemberRepo.update).toHaveBeenCalledWith(
        'm2',
        expect.any(Object),
      );
      expect(mockMemberRepo.update).not.toHaveBeenCalledWith(
        'm1',
        expect.any(Object),
      );
    });

    it('skips when another instance holds the lock', async () => {
      mockCacheService.acquireLock.mockResolvedValue(false);

      await service.triggerBirthdayGreetings();

      expect(mockMemberRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('releases the lock even when the run completes with no members', async () => {
      const qb = makeQb();
      qb.getMany.mockResolvedValue([]);
      mockMemberRepo.createQueryBuilder.mockReturnValue(qb);

      await service.triggerBirthdayGreetings();

      expect(mockCacheService.releaseLock).toHaveBeenCalledWith(
        'lock:birthday-greetings',
      );
    });
  });

  describe('sendWish', () => {
    it('throws BadRequestException when sender and recipient are the same', async () => {
      mockCacheService.get.mockResolvedValue(0);

      await expect(
        service.sendWish('same-id', 'same-id', 'Happy birthday!'),
      ).rejects.toThrow(
        new BadRequestException('You cannot send a wish to yourself'),
      );
    });

    it('throws 429 when the daily rate limit is reached', async () => {
      mockConfigService.get.mockReturnValue(20);
      mockCacheService.get.mockResolvedValue(20);

      await expect(
        service.sendWish('recipient-id', 'sender-id', 'HB!'),
      ).rejects.toThrow(
        new HttpException(
          'You have reached your daily limit for birthday wishes. Please try again tomorrow.',
          HttpStatus.TOO_MANY_REQUESTS,
        ),
      );
      expect(mockWishRepo.findOne).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when a wish was already sent this year', async () => {
      mockCacheService.get.mockResolvedValue(0);
      mockWishRepo.findOne.mockResolvedValue({ id: 'existing-wish' });

      await expect(
        service.sendWish('recipient-id', 'sender-id', 'HB!'),
      ).rejects.toThrow(BadRequestException);
      expect(mockWishRepo.save).not.toHaveBeenCalled();
    });

    it('sanitizes the message before saving', async () => {
      mockCacheService.get.mockResolvedValue(0);
      mockWishRepo.findOne.mockResolvedValue(null);
      mockSanitizationService.sanitizeText.mockReturnValue('Happy Birthday!');
      const saved = { id: 'wish-1', message: 'Happy Birthday!' };
      mockWishRepo.create.mockReturnValue(saved);
      mockWishRepo.save.mockResolvedValue(saved);

      await service.sendWish(
        'recipient-id',
        'sender-id',
        '<script>xss</script>Happy Birthday!',
      );

      expect(mockSanitizationService.sanitizeText).toHaveBeenCalledWith(
        '<script>xss</script>Happy Birthday!',
      );
      expect(mockWishRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Happy Birthday!' }),
      );
    });

    it('saves the wish and increments the rate counter on success', async () => {
      mockCacheService.get.mockResolvedValue(3);
      mockConfigService.get.mockReturnValue(20);
      mockWishRepo.findOne.mockResolvedValue(null);
      const saved = { id: 'wish-1', message: 'HB!' };
      mockWishRepo.create.mockReturnValue(saved);
      mockWishRepo.save.mockResolvedValue(saved);

      const result = await service.sendWish('recipient-id', 'sender-id', 'HB!');

      expect(result).toEqual(saved);
      expect(mockCacheService.incr).toHaveBeenCalledWith(
        expect.stringContaining('sender-id'),
        expect.any(Number),
      );
    });
  });

  describe('getTodaysBirthdays', () => {
    it('queries by birthMonth/birthDay/status and loads workerProfile/department/pastor relations', async () => {
      mockMemberRepo.find.mockResolvedValue([]);

      await service.getTodaysBirthdays();

      expect(mockMemberRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: MemberStatusEnum.ACTIVE }),
          relations: ['workerProfile', 'workerProfile.department', 'pastor'],
        }),
      );
    });

    it('never includes email or phoneNumber in the returned shape', async () => {
      mockMemberRepo.find.mockResolvedValue([
        makeMember({
          id: 'member-1',
          email: 'should-not-leak@test.com',
          phoneNumber: '+1234567890',
        } as any),
      ]);

      const result = await service.getTodaysBirthdays();

      expect(result[0]).not.toHaveProperty('email');
      expect(result[0]).not.toHaveProperty('phoneNumber');
    });

    it('derives departmentName from workerProfile.department and pastorType from pastor', async () => {
      mockMemberRepo.find.mockResolvedValue([
        makeMember({
          id: 'member-1',
          workerProfile: { department: { name: 'Worship' } },
        } as any),
        makeMember({
          id: 'member-2',
          pastor: { type: 'LEAD' },
        } as any),
        makeMember({ id: 'member-3' } as any),
      ]);

      const result = await service.getTodaysBirthdays();

      expect(result.find((m) => m.id === 'member-1')?.departmentName).toBe(
        'Worship',
      );
      expect(result.find((m) => m.id === 'member-1')?.pastorType).toBeNull();
      expect(result.find((m) => m.id === 'member-2')?.pastorType).toBe('LEAD');
      expect(
        result.find((m) => m.id === 'member-3')?.departmentName,
      ).toBeNull();
      expect(result.find((m) => m.id === 'member-3')?.pastorType).toBeNull();
    });

    it('flags alreadyWishedByMe only for recipients the current sender already wished this year', async () => {
      mockMemberRepo.find.mockResolvedValue([
        makeMember({ id: 'member-1' }),
        makeMember({ id: 'member-2' }),
      ]);
      mockWishRepo.find.mockResolvedValue([{ recipient: { id: 'member-1' } }]);

      const result = await service.getTodaysBirthdays('sender-1');

      expect(mockWishRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sender: { id: 'sender-1' },
          }),
        }),
      );
      expect(result.find((m) => m.id === 'member-1')?.alreadyWishedByMe).toBe(
        true,
      );
      expect(result.find((m) => m.id === 'member-2')?.alreadyWishedByMe).toBe(
        false,
      );
    });

    it('skips the wish lookup entirely when no currentMemberId is provided', async () => {
      mockMemberRepo.find.mockResolvedValue([makeMember({ id: 'member-1' })]);
      mockWishRepo.find.mockResolvedValue([]);

      const result = await service.getTodaysBirthdays();

      expect(mockWishRepo.find).not.toHaveBeenCalled();
      expect(result[0].alreadyWishedByMe).toBe(false);
    });
  });

  describe('getUpcomingBirthdays', () => {
    const makeUpcomingQb = () => ({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    });

    it('defaults to a 7-day window when no days argument is given', async () => {
      const qb = makeUpcomingQb();
      mockMemberRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getUpcomingBirthdays();

      const whereCall = qb.where.mock.calls[0][0] as string;
      const conditionCount = (whereCall.match(/m\.birthMonth/g) ?? []).length;
      expect(conditionCount).toBe(7);
    });

    it('generates the correct number of day conditions for a custom window', async () => {
      const qb = makeUpcomingQb();
      mockMemberRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getUpcomingBirthdays(30);

      const whereCall = qb.where.mock.calls[0][0] as string;
      const conditionCount = (whereCall.match(/m\.birthMonth/g) ?? []).length;
      expect(conditionCount).toBe(30);
    });

    it('filters only ACTIVE members', async () => {
      const qb = makeUpcomingQb();
      mockMemberRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getUpcomingBirthdays(7);

      expect(qb.andWhere).toHaveBeenCalledWith('m.status = :status', {
        status: MemberStatusEnum.ACTIVE,
      });
    });

    it('orders results by birthMonth then birthDay', async () => {
      const qb = makeUpcomingQb();
      mockMemberRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getUpcomingBirthdays(7);

      expect(qb.orderBy).toHaveBeenCalledWith('m.birthMonth', 'ASC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('m.birthDay', 'ASC');
    });
  });

  describe('getWishesForMember', () => {
    it('returns wishes without year filter', async () => {
      const wishes = [{ id: 'w1', message: 'HB!' }];
      const qb = makeQb();
      qb.getMany.mockResolvedValue(wishes);
      mockWishRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getWishesForMember('member-id');

      expect(result).toEqual(wishes);
      expect(qb.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('year'),
        expect.anything(),
      );
    });

    it('adds a year filter when year is provided', async () => {
      const qb = makeQb();
      qb.getMany.mockResolvedValue([]);
      mockWishRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getWishesForMember('member-id', 2026);

      expect(qb.andWhere).toHaveBeenCalledWith('w.year = :year', {
        year: 2026,
      });
    });
  });
});
