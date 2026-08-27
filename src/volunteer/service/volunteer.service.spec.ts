import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VolunteerService } from './volunteer.service';
import { VolunteerOpportunity } from '../entity/volunteer-opportunity.entity';
import { VolunteerSignup } from '../entity/volunteer-signup.entity';
import { VolunteerOpportunityStatusEnum } from '../enum/volunteer-opportunity-status.enum';
import { VolunteerSignupStatusEnum } from '../enum/volunteer-signup-status.enum';
import { AuditLogService } from '../../utility/service/audit-log.service';

const mockOpportunityRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockSignupRepo = {
  find: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };

const mockAdmin = { id: 'admin-1' } as any;

const makeQb = () => ({
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  setLock: jest.fn().mockReturnThis(),
  getOne: jest.fn(),
  getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
});

// ── Transaction manager mock ────────────────────────────────────────────────

const mockOpportunityTxRepo = {
  createQueryBuilder: jest.fn(),
  save: jest.fn(),
};

const mockSignupTxRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const mockTxManager = {
  getRepository: jest.fn((entity: any) =>
    entity === VolunteerOpportunity ? mockOpportunityTxRepo : mockSignupTxRepo,
  ),
};

const mockTxHost = { tx: mockTxManager };

describe('VolunteerService', () => {
  let service: VolunteerService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VolunteerService,
        { provide: TransactionHost, useValue: mockTxHost },
        {
          provide: getRepositoryToken(VolunteerOpportunity),
          useValue: mockOpportunityRepo,
        },
        {
          provide: getRepositoryToken(VolunteerSignup),
          useValue: mockSignupRepo,
        },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<VolunteerService>(VolunteerService);
  });

  describe('create', () => {
    it('creates an opportunity and logs VOLUNTEER_OPPORTUNITY_CREATED', async () => {
      const saved = { id: 'opp-1', title: 'Ushering' };
      mockOpportunityRepo.create.mockReturnValue(saved);
      mockOpportunityRepo.save.mockResolvedValue(saved);

      const result = await service.create(
        { title: 'Ushering', date: '2026-08-01' },
        mockAdmin,
      );

      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'VOLUNTEER_OPPORTUNITY_CREATED',
        expect.objectContaining({ actorId: 'admin-1', targetId: 'opp-1' }),
      );
      expect(result).toBe(saved);
    });
  });

  describe('cancelOpportunity', () => {
    it('throws NotFoundException when the opportunity does not exist', async () => {
      mockOpportunityRepo.findOne.mockResolvedValue(null);
      await expect(
        service.cancelOpportunity('missing', mockAdmin),
      ).rejects.toThrow(NotFoundException);
    });

    it('sets status to CANCELLED and logs VOLUNTEER_OPPORTUNITY_CANCELLED', async () => {
      const opportunity = {
        id: 'opp-1',
        status: VolunteerOpportunityStatusEnum.OPEN,
      };
      mockOpportunityRepo.findOne.mockResolvedValue(opportunity);
      mockOpportunityRepo.save.mockImplementation((o) => Promise.resolve(o));

      const result = await service.cancelOpportunity('opp-1', mockAdmin);

      expect(result.status).toBe(VolunteerOpportunityStatusEnum.CANCELLED);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'VOLUNTEER_OPPORTUNITY_CANCELLED',
        expect.objectContaining({ actorId: 'admin-1', targetId: 'opp-1' }),
      );
    });
  });

  describe('signUp', () => {
    it('throws NotFoundException when the opportunity does not exist', async () => {
      const qb = makeQb();
      qb.getOne.mockResolvedValue(null);
      mockOpportunityTxRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(service.signUp('missing', 'member-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when the opportunity is not OPEN', async () => {
      const qb = makeQb();
      qb.getOne.mockResolvedValue({
        id: 'opp-1',
        status: VolunteerOpportunityStatusEnum.CLOSED,
        capacity: null,
        confirmedCount: 0,
      });
      mockOpportunityTxRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(service.signUp('opp-1', 'member-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the opportunity is at capacity', async () => {
      const qb = makeQb();
      qb.getOne.mockResolvedValue({
        id: 'opp-1',
        status: VolunteerOpportunityStatusEnum.OPEN,
        capacity: 2,
        confirmedCount: 2,
      });
      mockOpportunityTxRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(service.signUp('opp-1', 'member-1')).rejects.toThrow(
        'This opportunity is full.',
      );
    });

    it('creates a new signup and increments confirmedCount when under capacity', async () => {
      const opportunity = {
        id: 'opp-1',
        status: VolunteerOpportunityStatusEnum.OPEN,
        capacity: 2,
        confirmedCount: 1,
      };
      const qb = makeQb();
      qb.getOne.mockResolvedValue(opportunity);
      mockOpportunityTxRepo.createQueryBuilder.mockReturnValue(qb);
      mockSignupTxRepo.findOne.mockResolvedValue(null);
      const created = { status: VolunteerSignupStatusEnum.CONFIRMED };
      mockSignupTxRepo.create.mockReturnValue(created);
      mockSignupTxRepo.save.mockResolvedValue({ id: 'signup-1', ...created });
      mockOpportunityTxRepo.save.mockResolvedValue(opportunity);

      const result = await service.signUp('opp-1', 'member-1');

      expect(opportunity.confirmedCount).toBe(2);
      expect(mockOpportunityTxRepo.save).toHaveBeenCalledWith(opportunity);
      expect(result).toEqual({ id: 'signup-1', ...created });
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'VOLUNTEER_SIGNUP_CREATED',
        expect.objectContaining({ actorId: 'member-1', targetId: 'opp-1' }),
      );
    });

    it('re-confirms a previously-cancelled signup instead of creating a duplicate', async () => {
      const opportunity = {
        id: 'opp-1',
        status: VolunteerOpportunityStatusEnum.OPEN,
        capacity: null,
        confirmedCount: 0,
      };
      const qb = makeQb();
      qb.getOne.mockResolvedValue(opportunity);
      mockOpportunityTxRepo.createQueryBuilder.mockReturnValue(qb);
      const existing = {
        id: 'signup-1',
        status: VolunteerSignupStatusEnum.CANCELLED,
      };
      mockSignupTxRepo.findOne.mockResolvedValue(existing);
      mockSignupTxRepo.save.mockImplementation((s) => Promise.resolve(s));
      mockOpportunityTxRepo.save.mockResolvedValue(opportunity);

      const result = await service.signUp('opp-1', 'member-1');

      expect(mockSignupTxRepo.create).not.toHaveBeenCalled();
      expect(result.status).toBe(VolunteerSignupStatusEnum.CONFIRMED);
    });

    it('returns the existing signup without incrementing again when already CONFIRMED', async () => {
      const opportunity = {
        id: 'opp-1',
        status: VolunteerOpportunityStatusEnum.OPEN,
        capacity: null,
        confirmedCount: 1,
      };
      const qb = makeQb();
      qb.getOne.mockResolvedValue(opportunity);
      mockOpportunityTxRepo.createQueryBuilder.mockReturnValue(qb);
      const existing = {
        id: 'signup-1',
        status: VolunteerSignupStatusEnum.CONFIRMED,
      };
      mockSignupTxRepo.findOne.mockResolvedValue(existing);

      const result = await service.signUp('opp-1', 'member-1');

      expect(result).toBe(existing);
      expect(opportunity.confirmedCount).toBe(1);
      expect(mockOpportunityTxRepo.save).not.toHaveBeenCalled();
    });

    it('returns an already-CONFIRMED signup even if the opportunity has since closed', async () => {
      const opportunity = {
        id: 'opp-1',
        status: VolunteerOpportunityStatusEnum.CLOSED,
        capacity: null,
        confirmedCount: 1,
      };
      const qb = makeQb();
      qb.getOne.mockResolvedValue(opportunity);
      mockOpportunityTxRepo.createQueryBuilder.mockReturnValue(qb);
      const existing = {
        id: 'signup-1',
        status: VolunteerSignupStatusEnum.CONFIRMED,
      };
      mockSignupTxRepo.findOne.mockResolvedValue(existing);

      const result = await service.signUp('opp-1', 'member-1');

      expect(result).toBe(existing);
    });

    it('returns an already-CONFIRMED signup even if the opportunity has since filled up', async () => {
      const opportunity = {
        id: 'opp-1',
        status: VolunteerOpportunityStatusEnum.OPEN,
        capacity: 1,
        confirmedCount: 1,
      };
      const qb = makeQb();
      qb.getOne.mockResolvedValue(opportunity);
      mockOpportunityTxRepo.createQueryBuilder.mockReturnValue(qb);
      const existing = {
        id: 'signup-1',
        status: VolunteerSignupStatusEnum.CONFIRMED,
      };
      mockSignupTxRepo.findOne.mockResolvedValue(existing);

      const result = await service.signUp('opp-1', 'member-1');

      expect(result).toBe(existing);
    });
  });

  describe('cancelMySignUp', () => {
    it('throws NotFoundException when the member has no confirmed signup', async () => {
      const qb = makeQb();
      qb.getOne.mockResolvedValue({ id: 'opp-1', confirmedCount: 1 });
      mockOpportunityTxRepo.createQueryBuilder.mockReturnValue(qb);
      mockSignupTxRepo.findOne.mockResolvedValue(null);

      await expect(service.cancelMySignUp('opp-1', 'member-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('cancels the signup and decrements confirmedCount', async () => {
      const opportunity = { id: 'opp-1', confirmedCount: 3 };
      const qb = makeQb();
      qb.getOne.mockResolvedValue(opportunity);
      mockOpportunityTxRepo.createQueryBuilder.mockReturnValue(qb);
      const signup = {
        id: 'signup-1',
        status: VolunteerSignupStatusEnum.CONFIRMED,
      };
      mockSignupTxRepo.findOne.mockResolvedValue(signup);
      mockSignupTxRepo.save.mockImplementation((s) => Promise.resolve(s));
      mockOpportunityTxRepo.save.mockResolvedValue(opportunity);

      await service.cancelMySignUp('opp-1', 'member-1');

      expect(signup.status).toBe(VolunteerSignupStatusEnum.CANCELLED);
      expect(opportunity.confirmedCount).toBe(2);
    });

    it('never decrements below zero', async () => {
      const opportunity = { id: 'opp-1', confirmedCount: 0 };
      const qb = makeQb();
      qb.getOne.mockResolvedValue(opportunity);
      mockOpportunityTxRepo.createQueryBuilder.mockReturnValue(qb);
      mockSignupTxRepo.findOne.mockResolvedValue({
        id: 'signup-1',
        status: VolunteerSignupStatusEnum.CONFIRMED,
      });
      mockSignupTxRepo.save.mockImplementation((s) => Promise.resolve(s));
      mockOpportunityTxRepo.save.mockResolvedValue(opportunity);

      await service.cancelMySignUp('opp-1', 'member-1');

      expect(opportunity.confirmedCount).toBe(0);
    });
  });

  describe('listOpportunities', () => {
    it('throws BadRequestException when page is less than 1', async () => {
      await expect(service.listOpportunities(0)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns paginated opportunities ordered by date desc', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[{ id: 'opp-1' }], 1]);
      mockOpportunityRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.listOpportunities(1, 20);

      expect(result.totalCount).toBe(1);
      expect(qb.orderBy).toHaveBeenCalledWith('o.date', 'DESC');
    });
  });
});
