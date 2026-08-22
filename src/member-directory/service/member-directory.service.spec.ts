import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MemberDirectoryService } from './member-directory.service';
import { MemberDirectoryProfile } from '../entity/member-directory-profile.entity';

const mockQueryBuilder = {
  innerJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn(),
};

const mockProfileRepo = {
  findOne: jest.fn(),
  // Shallow copy, not the same reference — real TypeORM's create() returns
  // a new entity instance, and returning the literal input here would let
  // a later Object.assign(profile, dto) retroactively mutate what
  // toHaveBeenCalledWith already captured.
  create: jest.fn((v) => ({ ...v })),
  save: jest.fn(),
  find: jest.fn(),
  createQueryBuilder: jest.fn(() => mockQueryBuilder),
};

describe('MemberDirectoryService', () => {
  let service: MemberDirectoryService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberDirectoryService,
        {
          provide: getRepositoryToken(MemberDirectoryProfile),
          useValue: mockProfileRepo,
        },
      ],
    }).compile();
    service = module.get(MemberDirectoryService);
  });

  describe('getMyProfile', () => {
    it('returns a default (invisible, empty) profile when none exists yet', async () => {
      mockProfileRepo.findOne.mockResolvedValue(null);
      const result = await service.getMyProfile('member-1');
      expect(result).toEqual({
        occupation: null,
        businessName: null,
        skills: null,
        bio: null,
        isVisible: false,
        showPhone: false,
        showEmail: false,
      });
    });

    it('returns the existing profile fields, never the member relation itself', async () => {
      mockProfileRepo.findOne.mockResolvedValue({
        id: 'p1',
        member: { id: 'member-1', firstname: 'Jane' },
        occupation: 'Accountant',
        businessName: null,
        skills: 'Excel,Tax prep',
        bio: 'Loves numbers',
        isVisible: true,
        showPhone: false,
        showEmail: true,
      });
      const result = await service.getMyProfile('member-1');
      expect(result).toEqual({
        occupation: 'Accountant',
        businessName: null,
        skills: 'Excel,Tax prep',
        bio: 'Loves numbers',
        isVisible: true,
        showPhone: false,
        showEmail: true,
      });
      expect(result).not.toHaveProperty('member');
    });
  });

  describe('upsertMyProfile', () => {
    it('creates a new profile row for a member with none yet', async () => {
      mockProfileRepo.findOne.mockResolvedValue(null);
      mockProfileRepo.save.mockImplementation((p) => Promise.resolve(p));

      await service.upsertMyProfile('member-1', {
        occupation: 'Nurse',
        isVisible: true,
      });

      expect(mockProfileRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          member: { id: 'member-1' },
          isVisible: false,
        }),
      );
      expect(mockProfileRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ occupation: 'Nurse', isVisible: true }),
      );
    });

    it('updates the existing profile row rather than duplicating it', async () => {
      const existing = {
        id: 'p1',
        member: { id: 'member-1' },
        occupation: 'Old title',
        businessName: null,
        skills: null,
        bio: null,
        isVisible: false,
        showPhone: false,
        showEmail: false,
      };
      mockProfileRepo.findOne.mockResolvedValue(existing);
      mockProfileRepo.save.mockImplementation((p) => Promise.resolve(p));

      await service.upsertMyProfile('member-1', { occupation: 'New title' });

      expect(mockProfileRepo.create).not.toHaveBeenCalled();
      expect(mockProfileRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ occupation: 'New title' }),
      );
    });
  });

  describe('search', () => {
    it('only ever queries isVisible = true profiles', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
      await service.search(undefined, 1, 20);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'profile.isVisible = true',
      );
    });

    it('omits phoneNumber/email from a result row unless that row opted in', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([
        [
          {
            member: {
              id: 'm1',
              firstname: 'Jane',
              lastname: 'Doe',
              photoUrl: null,
              phoneNumber: '+1234567890',
              email: 'jane@example.com',
            },
            occupation: 'Accountant',
            businessName: null,
            skills: null,
            bio: null,
            showPhone: false,
            showEmail: false,
          },
        ],
        1,
      ]);

      const result = await service.search('accountant', 1, 20);

      expect(result.data[0]).not.toHaveProperty('phoneNumber');
      expect(result.data[0]).not.toHaveProperty('email');
    });

    it('includes phoneNumber/email only for rows that opted in', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([
        [
          {
            member: {
              id: 'm1',
              firstname: 'Jane',
              lastname: 'Doe',
              photoUrl: null,
              phoneNumber: '+1234567890',
              email: 'jane@example.com',
            },
            occupation: 'Accountant',
            businessName: null,
            skills: null,
            bio: null,
            showPhone: true,
            showEmail: true,
          },
        ],
        1,
      ]);

      const result = await service.search(undefined, 1, 20);

      expect(result.data[0].phoneNumber).toBe('+1234567890');
      expect(result.data[0].email).toBe('jane@example.com');
    });

    it('adds a search predicate across name/occupation/business/skills when a query is given', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
      await service.search('catering', 1, 20);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('profile.businessName'),
        { s: '%catering%' },
      );
    });
  });

  describe('getCompletionStatus', () => {
    it('reports not discoverable when no profile exists yet', async () => {
      mockProfileRepo.findOne.mockResolvedValue(null);
      const result = await service.getCompletionStatus('member-1');
      expect(result.isDiscoverable).toBe(false);
      expect(result.isVisible).toBe(false);
    });

    it('reports discoverable only when visible AND at least one of occupation/business/skills is set', async () => {
      mockProfileRepo.findOne.mockResolvedValue({
        occupation: null,
        businessName: null,
        skills: null,
        bio: 'Just a bio, no structured fields',
        isVisible: true,
      });
      const result = await service.getCompletionStatus('member-1');
      expect(result.isDiscoverable).toBe(false);
    });

    it('reports discoverable when visible and occupation is set', async () => {
      mockProfileRepo.findOne.mockResolvedValue({
        occupation: 'Nurse',
        businessName: null,
        skills: null,
        bio: null,
        isVisible: true,
      });
      const result = await service.getCompletionStatus('member-1');
      expect(result.isDiscoverable).toBe(true);
    });
  });

  describe('getAnalytics', () => {
    it('only counts opted-in (isVisible) profiles', async () => {
      mockProfileRepo.find.mockResolvedValue([]);
      await service.getAnalytics(50);
      expect(mockProfileRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isVisible: true } }),
      );
    });

    it('groups members by occupation and sorts by count descending', async () => {
      mockProfileRepo.find.mockResolvedValue([
        {
          occupation: 'Nurse',
          member: { id: 'm1', firstname: 'A', lastname: 'A' },
        },
        {
          occupation: 'Accountant',
          member: { id: 'm2', firstname: 'B', lastname: 'B' },
        },
        {
          occupation: 'Nurse',
          member: { id: 'm3', firstname: 'C', lastname: 'C' },
        },
        {
          occupation: null,
          member: { id: 'm4', firstname: 'D', lastname: 'D' },
        },
      ]);

      const result = await service.getAnalytics(100);

      expect(result.totalOptedIn).toBe(4);
      expect(result.totalMembers).toBe(100);
      expect(result.occupationBreakdown[0]).toEqual(
        expect.objectContaining({ occupation: 'Nurse' }),
      );
      expect(result.occupationBreakdown[0].members).toHaveLength(2);
      // members with no occupation set are excluded from the breakdown
      expect(result.occupationBreakdown.every((e) => e.occupation)).toBe(true);
      expect(
        result.occupationBreakdown.reduce((n, e) => n + e.members.length, 0),
      ).toBe(3);
    });
  });
});
