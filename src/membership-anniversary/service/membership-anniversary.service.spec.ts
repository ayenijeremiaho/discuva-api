import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

// AnnouncementService transitively imports SanitizationService, which pulls
// in jsdom — mocked here (as announcement.service.spec.ts does) so this
// spec doesn't need jsdom's ESM-only transitive deps just to get a DI token.
jest.mock('../../utility/service/sanitization.service', () => ({
  SanitizationService: jest.fn().mockImplementation(() => ({
    sanitize: jest.fn((html: string) => html),
    sanitizeText: jest.fn((text: string) => text),
    sanitizeForEmail: jest.fn((html: string) => html),
  })),
}));

import { MembershipAnniversaryService } from './membership-anniversary.service';
import { Member } from '../../member/entity/member.entity';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { AnnouncementService } from '../../announcement/service/announcement.service';
import { UtilityService } from '../../utility/service/utility.service';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

const makeQb = () => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
});

const mockMemberRepo = {
  createQueryBuilder: jest.fn(),
  update: jest.fn().mockResolvedValue(undefined),
};

const mockAnnouncementService = {
  createSystemAnnouncement: jest.fn().mockResolvedValue({ id: 'ann-1' }),
};

const mockUtilityService = {
  sendEmailWithTemplate: jest.fn(),
};

const mockCacheService = {
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };

const CURRENT_YEAR = new Date().getFullYear();

const makeMember = (overrides: Partial<Member> = {}): Member =>
  ({
    id: 'member-1',
    firstname: 'John',
    lastname: 'Doe',
    email: 'john@example.com',
    status: MemberStatusEnum.ACTIVE,
    dateJoinedChurch: new Date(`${CURRENT_YEAR - 3}-06-15`),
    anniversaryGreetedYear: null,
    ...overrides,
  }) as Member;

describe('MembershipAnniversaryService', () => {
  let service: MembershipAnniversaryService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.acquireLock.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipAnniversaryService,
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        { provide: AnnouncementService, useValue: mockAnnouncementService },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<MembershipAnniversaryService>(
      MembershipAnniversaryService,
    );
  });

  describe('triggerAnniversaryGreetings', () => {
    it('does nothing when no members have an anniversary today', async () => {
      const qb = makeQb();
      qb.getMany.mockResolvedValue([]);
      mockMemberRepo.createQueryBuilder.mockReturnValue(qb);

      await service.triggerAnniversaryGreetings();

      expect(
        mockAnnouncementService.createSystemAnnouncement,
      ).not.toHaveBeenCalled();
      expect(mockUtilityService.sendEmailWithTemplate).not.toHaveBeenCalled();
    });

    it('announces and emails each celebrant, with the correct years-with-us count', async () => {
      const member = makeMember({
        id: 'm1',
        dateJoinedChurch: new Date(`${CURRENT_YEAR - 5}-06-15`),
      });
      const qb = makeQb();
      qb.getMany.mockResolvedValue([member]);
      mockMemberRepo.createQueryBuilder.mockReturnValue(qb);

      await service.triggerAnniversaryGreetings();

      expect(
        mockAnnouncementService.createSystemAnnouncement,
      ).toHaveBeenCalledWith(
        expect.stringContaining('5 years'),
        expect.stringContaining('5 years'),
      );
      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
        'john@example.com',
        expect.stringContaining('5 Years'),
        'membership-anniversary',
        expect.objectContaining({ years: 5 }),
        undefined,
        expect.any(String),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'MEMBERSHIP_ANNIVERSARY_GREETED',
        expect.objectContaining({ targetId: 'm1', metadata: { years: 5 } }),
      );
    });

    it('queries only ACTIVE members with a join date, not yet greeted this year, and excludes the join year itself', async () => {
      const qb = makeQb();
      qb.getMany.mockResolvedValue([]);
      mockMemberRepo.createQueryBuilder.mockReturnValue(qb);

      await service.triggerAnniversaryGreetings();

      expect(qb.where).toHaveBeenCalledWith('m.dateJoinedChurch IS NOT NULL');
      expect(qb.andWhere).toHaveBeenCalledWith('m.status = :status', {
        status: MemberStatusEnum.ACTIVE,
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'EXTRACT(YEAR FROM m.dateJoinedChurch) < :year',
        { year: CURRENT_YEAR },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(m.anniversaryGreetedYear IS NULL OR m.anniversaryGreetedYear != :year)',
        { year: CURRENT_YEAR },
      );
    });

    it('sets anniversaryGreetedYear after greeting succeeds', async () => {
      const member = makeMember({ id: 'm1' });
      const qb = makeQb();
      qb.getMany.mockResolvedValue([member]);
      mockMemberRepo.createQueryBuilder.mockReturnValue(qb);

      await service.triggerAnniversaryGreetings();

      expect(mockMemberRepo.update).toHaveBeenCalledWith('m1', {
        anniversaryGreetedYear: CURRENT_YEAR,
      });
    });

    it('continues to the next member when one greeting fails', async () => {
      const members = [
        makeMember({ id: 'm1' }),
        makeMember({ id: 'm2', firstname: 'Jane' }),
      ];
      const qb = makeQb();
      qb.getMany.mockResolvedValue(members);
      mockMemberRepo.createQueryBuilder.mockReturnValue(qb);
      mockAnnouncementService.createSystemAnnouncement
        .mockRejectedValueOnce(new Error('DB timeout'))
        .mockResolvedValue({ id: 'ann-1' });

      await service.triggerAnniversaryGreetings();

      expect(mockMemberRepo.update).toHaveBeenCalledTimes(1);
      expect(mockMemberRepo.update).toHaveBeenCalledWith(
        'm2',
        expect.any(Object),
      );
    });

    it('skips when another instance holds the lock', async () => {
      mockCacheService.acquireLock.mockResolvedValue(false);

      await service.triggerAnniversaryGreetings();

      expect(mockMemberRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('releases the lock even when the run completes with no members', async () => {
      const qb = makeQb();
      qb.getMany.mockResolvedValue([]);
      mockMemberRepo.createQueryBuilder.mockReturnValue(qb);

      await service.triggerAnniversaryGreetings();

      expect(mockCacheService.releaseLock).toHaveBeenCalledWith(
        'lock:membership-anniversary-greetings',
      );
    });
  });
});
