import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ServiceRatingService } from './service-rating.service';
import { ServiceRating } from '../entity/service-rating.entity';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';

const makeQb = () => ({
  innerJoin: jest.fn().mockReturnThis(),
  innerJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
  getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
});

const mockRatingRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockServiceSlotRepo = {
  findOne: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };

const mockAdmin = (permissions: AdminPermission[] = []) =>
  ({
    id: 'admin-1',
    adminRole: { permissions },
  }) as any;

describe('ServiceRatingService', () => {
  let service: ServiceRatingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceRatingService,
        {
          provide: getRepositoryToken(ServiceRating),
          useValue: mockRatingRepo,
        },
        {
          provide: getRepositoryToken(ServiceSlot),
          useValue: mockServiceSlotRepo,
        },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<ServiceRatingService>(ServiceRatingService);
  });

  describe('submitRating', () => {
    it('throws NotFoundException when the service slot does not belong to the event', async () => {
      mockServiceSlotRepo.findOne.mockResolvedValue(null);
      await expect(
        service.submitRating(
          { eventId: 'e1', serviceSlotId: 's1', rating: 5 },
          'member-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a new rating when none exists yet', async () => {
      mockServiceSlotRepo.findOne.mockResolvedValue({ id: 's1' });
      mockRatingRepo.findOne.mockResolvedValue(null);
      const created = { rating: 5 };
      mockRatingRepo.create.mockReturnValue(created);
      mockRatingRepo.save.mockResolvedValue({ id: 'r1', ...created });

      const result = await service.submitRating(
        { eventId: 'e1', serviceSlotId: 's1', rating: 5, comment: 'Great!' },
        'member-1',
      );

      expect(mockRatingRepo.create).toHaveBeenCalledWith({
        event: { id: 'e1' },
        serviceSlot: { id: 's1' },
        member: { id: 'member-1' },
        rating: 5,
        comment: 'Great!',
      });
      expect(result).toEqual({ id: 'r1', rating: 5 });
    });

    it('edits the existing rating in place instead of creating a duplicate', async () => {
      mockServiceSlotRepo.findOne.mockResolvedValue({ id: 's1' });
      const existing = { id: 'r1', rating: 2, comment: 'Meh' };
      mockRatingRepo.findOne.mockResolvedValue(existing);
      mockRatingRepo.save.mockImplementation((r) => Promise.resolve(r));

      const result = await service.submitRating(
        {
          eventId: 'e1',
          serviceSlotId: 's1',
          rating: 5,
          comment: 'Actually great',
        },
        'member-1',
      );

      expect(mockRatingRepo.create).not.toHaveBeenCalled();
      expect(result.rating).toBe(5);
      expect(result.comment).toBe('Actually great');
    });
  });

  describe('getSummary', () => {
    it('returns zeroed summary when there are no ratings', async () => {
      const qb = makeQb();
      mockRatingRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getSummary();

      expect(result.totalRatings).toBe(0);
      expect(result.averageRating).toBe(0);
      expect(result.distribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    });

    it('computes average and distribution across ratings', async () => {
      const qb = makeQb();
      qb.getMany.mockResolvedValue([
        { rating: 5 },
        { rating: 5 },
        { rating: 1 },
      ]);
      mockRatingRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getSummary();

      expect(result.totalRatings).toBe(3);
      expect(result.averageRating).toBeCloseTo(3.6667, 3);
      expect(result.distribution[5]).toBe(2);
      expect(result.distribution[1]).toBe(1);
    });
  });

  describe('getComments', () => {
    it('returns comments without member identity when the admin lacks the moderate permission', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([
        [
          {
            id: 'r1',
            rating: 4,
            comment: 'Nice',
            createdAt: new Date(),
            serviceSlot: { name: 'First Service' },
            event: { name: 'Sunday' },
            member: { id: 'm1', firstname: 'John', lastname: 'Doe' },
          },
        ],
        1,
      ]);
      mockRatingRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getComments(
        mockAdmin([AdminPermission.SERVICE_RATING_READ]),
      );

      expect(result.data[0].member).toBeNull();
    });

    it('includes member identity when the admin has the moderate permission', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([
        [
          {
            id: 'r1',
            rating: 4,
            comment: 'Nice',
            createdAt: new Date(),
            serviceSlot: { name: 'First Service' },
            event: { name: 'Sunday' },
            member: { id: 'm1', firstname: 'John', lastname: 'Doe' },
          },
        ],
        1,
      ]);
      mockRatingRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getComments(
        mockAdmin([
          AdminPermission.SERVICE_RATING_READ,
          AdminPermission.SERVICE_RATING_MODERATE,
        ]),
      );

      expect(result.data[0].member).toEqual({
        id: 'm1',
        firstname: 'John',
        lastname: 'Doe',
      });
    });
  });

  describe('moderateDelete', () => {
    it('throws NotFoundException when the rating does not exist', async () => {
      mockRatingRepo.findOne.mockResolvedValue(null);
      await expect(
        service.moderateDelete('missing', mockAdmin()),
      ).rejects.toThrow(NotFoundException);
    });

    it('removes the rating and logs SERVICE_RATING_MODERATED', async () => {
      const rating = { id: 'r1' };
      mockRatingRepo.findOne.mockResolvedValue(rating);

      await service.moderateDelete('r1', mockAdmin());

      expect(mockRatingRepo.remove).toHaveBeenCalledWith(rating);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'SERVICE_RATING_MODERATED',
        expect.objectContaining({ actorId: 'admin-1', targetId: 'r1' }),
      );
    });
  });
});
