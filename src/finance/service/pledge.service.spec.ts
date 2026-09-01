import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PledgeService } from './pledge.service';
import { Pledge } from '../entity/pledge.entity';
import { PledgeCampaign } from '../entity/pledge-campaign.entity';
import { PledgeContribution } from '../entity/pledge-contribution.entity';
import { PledgeContributionStatus, PledgeStatus } from '../enum/finance.enum';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { UtilityService } from '../../utility/service/utility.service';

const mockPledgeRepo = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockCampaignRepo = {
  createQueryBuilder: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
};

const mockContributionRepo = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };
const mockUtilityService = { sendEmailWithTemplate: jest.fn() };

describe('PledgeService', () => {
  let service: PledgeService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PledgeService,
        { provide: getRepositoryToken(Pledge), useValue: mockPledgeRepo },
        {
          provide: getRepositoryToken(PledgeCampaign),
          useValue: mockCampaignRepo,
        },
        {
          provide: getRepositoryToken(PledgeContribution),
          useValue: mockContributionRepo,
        },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: UtilityService, useValue: mockUtilityService },
      ],
    }).compile();
    service = module.get<PledgeService>(PledgeService);
  });

  describe('findActiveCampaignsForMembers', () => {
    const makeQb = (entities: any[], raw: any[]) => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawAndEntities: jest.fn().mockResolvedValue({ entities, raw }),
    });

    it('filters to active, non-lapsed campaigns only', async () => {
      const qb = makeQb([], []);
      mockCampaignRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findActiveCampaignsForMembers();

      expect(qb.where).toHaveBeenCalledWith('c.isActive = true');
      expect(qb.andWhere).toHaveBeenCalledWith('c.endDate >= CURRENT_DATE');
    });

    it('maps entities + raw totals into a member-safe shape, excluding admin-only fields', async () => {
      const campaign = {
        id: 'c-1',
        name: 'Building Fund',
        fund: { name: 'Capital Projects' },
        targetAmount: '50000.00',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        description: 'New sanctuary roof',
        createdBy: { id: 'admin-1' },
      };
      const qb = makeQb(
        [campaign],
        [{ totalPledged: '12500.00', totalPaid: '5000.00' }],
      );
      mockCampaignRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findActiveCampaignsForMembers();

      expect(result).toEqual([
        {
          id: 'c-1',
          name: 'Building Fund',
          fundName: 'Capital Projects',
          targetAmount: 50000,
          totalPledged: 12500,
          totalPaid: 5000,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          description: 'New sanctuary roof',
        },
      ]);
      expect(Object.keys(result[0])).not.toContain('createdBy');
    });

    it('defaults totalPledged/totalPaid to 0 when no pledges exist yet for a campaign', async () => {
      const campaign = {
        id: 'c-2',
        name: 'Missions Trip',
        fund: null,
        targetAmount: '10000.00',
        startDate: '2026-02-01',
        endDate: '2026-06-30',
        description: null,
      };
      const qb = makeQb([campaign], [{ totalPledged: null, totalPaid: null }]);
      mockCampaignRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findActiveCampaignsForMembers();

      expect(result[0].totalPledged).toBe(0);
      expect(result[0].totalPaid).toBe(0);
      expect(result[0].fundName).toBeNull();
    });
  });

  describe('updateCampaignActive', () => {
    it('throws NotFoundException if the campaign does not exist', async () => {
      mockCampaignRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateCampaignActive('c-1', { isActive: false }, {
          id: 'admin-1',
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('toggles isActive and audit-logs the change', async () => {
      const campaign = { id: 'c-1', name: 'Building Fund', isActive: true };
      mockCampaignRepo.findOne.mockResolvedValue(campaign);
      mockCampaignRepo.save.mockImplementation((c: any) => Promise.resolve(c));

      const result = await service.updateCampaignActive(
        'c-1',
        { isActive: false },
        { id: 'admin-1' } as any,
      );

      expect(result.isActive).toBe(false);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'PLEDGE_CAMPAIGN_ACTIVE_UPDATED',
        expect.objectContaining({ metadata: { isActive: false } }),
      );
    });
  });

  describe('getMemberPledges', () => {
    it('attaches amountPaid computed from confirmed contributions', async () => {
      const pledge = { id: 'pledge-1', totalAmount: 50000 };
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawAndEntities: jest.fn().mockResolvedValue({
          entities: [pledge],
          raw: [{ amountPaid: '15000.00' }],
        }),
      };
      mockPledgeRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getMemberPledges('member-1');

      expect(qb.where).toHaveBeenCalledWith('member.id = :memberId', {
        memberId: 'member-1',
      });
      expect((result[0] as any).amountPaid).toBe(15000);
    });
  });

  describe('findPledges', () => {
    it('attaches amountPaid per pledge and returns pagination metadata', async () => {
      const pledge = { id: 'pledge-1', totalAmount: 20000 };
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1),
        getRawAndEntities: jest.fn().mockResolvedValue({
          entities: [pledge],
          raw: [{ amountPaid: '2000.00' }],
        }),
      };
      mockPledgeRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findPledges({ page: 1, limit: 20 });

      expect(result.totalCount).toBe(1);
      expect((result.data[0] as any).amountPaid).toBe(2000);
    });
  });

  describe('submitContribution', () => {
    it('throws NotFoundException if the pledge does not exist', async () => {
      mockPledgeRepo.findOne.mockResolvedValue(null);

      await expect(
        service.submitContribution('member-1', 'pledge-1', {
          amount: 5000,
          paymentDate: '2026-07-01',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException if the pledge belongs to another member', async () => {
      mockPledgeRepo.findOne.mockResolvedValue({
        id: 'pledge-1',
        status: PledgeStatus.ACTIVE,
        member: { id: 'someone-else' },
      });

      await expect(
        service.submitContribution('member-1', 'pledge-1', {
          amount: 5000,
          paymentDate: '2026-07-01',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException if the pledge is not ACTIVE', async () => {
      mockPledgeRepo.findOne.mockResolvedValue({
        id: 'pledge-1',
        status: PledgeStatus.COMPLETED,
        member: { id: 'member-1' },
      });

      await expect(
        service.submitContribution('member-1', 'pledge-1', {
          amount: 5000,
          paymentDate: '2026-07-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a PENDING contribution for the owning member', async () => {
      mockPledgeRepo.findOne.mockResolvedValue({
        id: 'pledge-1',
        status: PledgeStatus.ACTIVE,
        member: { id: 'member-1' },
      });
      const created = { id: 'contrib-1' };
      mockContributionRepo.create.mockReturnValue(created);
      mockContributionRepo.save.mockResolvedValue(created);

      const result = await service.submitContribution('member-1', 'pledge-1', {
        amount: 5000,
        paymentDate: '2026-07-01',
        reference: 'TXN1',
      });

      expect(result).toEqual(created);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'PLEDGE_CONTRIBUTION_SUBMITTED',
        expect.any(Object),
      );
    });
  });

  describe('recordConfirmedContribution', () => {
    it('creates a CONFIRMED contribution directly, with no PENDING/review step', async () => {
      mockPledgeRepo.findOne.mockResolvedValue({
        id: 'pledge-1',
        status: PledgeStatus.ACTIVE,
        totalAmount: 50000,
      });
      const created = { id: 'contrib-1' };
      mockContributionRepo.create.mockReturnValue(created);
      mockContributionRepo.save.mockResolvedValue(created);
      const sumQb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ sum: '5000' }),
      };
      mockContributionRepo.createQueryBuilder.mockReturnValue(sumQb);

      const result = await service.recordConfirmedContribution(
        'member-1',
        'pledge-1',
        5000,
        'giving_abc123',
      );

      expect(result).toEqual(created);
      expect(mockContributionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 5000,
          reference: 'giving_abc123',
          status: PledgeContributionStatus.CONFIRMED,
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'PLEDGE_CONTRIBUTION_CONFIRMED',
        expect.objectContaining({
          metadata: expect.objectContaining({ source: 'giving-checkout' }),
        }),
      );
    });

    it('auto-completes the pledge when the confirmed total covers it', async () => {
      mockPledgeRepo.findOne
        .mockResolvedValueOnce({
          id: 'pledge-1',
          status: PledgeStatus.ACTIVE,
          totalAmount: 5000,
        })
        .mockResolvedValueOnce({
          id: 'pledge-1',
          status: PledgeStatus.ACTIVE,
          totalAmount: 5000,
        });
      mockContributionRepo.create.mockReturnValue({ id: 'contrib-1' });
      mockContributionRepo.save.mockResolvedValue({ id: 'contrib-1' });
      mockPledgeRepo.save.mockResolvedValue({});
      const sumQb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ sum: '5000' }),
      };
      mockContributionRepo.createQueryBuilder.mockReturnValue(sumQb);

      await service.recordConfirmedContribution(
        'member-1',
        'pledge-1',
        5000,
        'giving_abc123',
      );

      expect(mockPledgeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: PledgeStatus.COMPLETED }),
      );
    });

    it('throws NotFoundException when the pledge does not exist', async () => {
      mockPledgeRepo.findOne.mockResolvedValue(null);

      await expect(
        service.recordConfirmedContribution(
          'member-1',
          'missing-pledge',
          5000,
          'giving_abc123',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirmContribution', () => {
    it('throws NotFoundException if no pending contribution matches', async () => {
      mockContributionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.confirmContribution('contrib-1', { id: 'admin-1' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('confirms, emails the member, and does not auto-complete when under target', async () => {
      const contribution = {
        id: 'contrib-1',
        amount: 5000,
        paymentDate: '2026-07-01',
        status: PledgeContributionStatus.PENDING,
        pledge: {
          id: 'pledge-1',
          totalAmount: 50000,
          status: PledgeStatus.ACTIVE,
          member: { email: 'a@b.com', firstname: 'ada' },
          campaign: { name: 'Building Fund' },
        },
      };
      mockContributionRepo.findOne.mockResolvedValue(contribution);
      mockContributionRepo.save.mockImplementation((c) => Promise.resolve(c));
      mockPledgeRepo.findOne.mockResolvedValue({
        id: 'pledge-1',
        status: PledgeStatus.ACTIVE,
        totalAmount: 50000,
      });
      const sumQb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ sum: '5000' }),
      };
      mockContributionRepo.createQueryBuilder.mockReturnValue(sumQb);

      const result = await service.confirmContribution('contrib-1', {
        id: 'admin-1',
      } as any);

      expect(result.status).toBe(PledgeContributionStatus.CONFIRMED);
      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
        'a@b.com',
        expect.any(String),
        'pledge-contribution-confirmed',
        expect.any(Object),
        undefined,
        expect.any(String),
      );
      expect(mockPledgeRepo.save).not.toHaveBeenCalled();
    });

    it('auto-completes the pledge once confirmed contributions cover the full amount', async () => {
      const contribution = {
        id: 'contrib-1',
        amount: 50000,
        paymentDate: '2026-07-01',
        status: PledgeContributionStatus.PENDING,
        pledge: {
          id: 'pledge-1',
          totalAmount: 50000,
          status: PledgeStatus.ACTIVE,
          member: { email: 'a@b.com', firstname: 'ada' },
          campaign: { name: 'Building Fund' },
        },
      };
      mockContributionRepo.findOne.mockResolvedValue(contribution);
      mockContributionRepo.save.mockImplementation((c) => Promise.resolve(c));
      const pledgeRow = {
        id: 'pledge-1',
        status: PledgeStatus.ACTIVE,
        totalAmount: 50000,
      };
      mockPledgeRepo.findOne.mockResolvedValue(pledgeRow);
      mockPledgeRepo.save.mockResolvedValue({
        ...pledgeRow,
        status: PledgeStatus.COMPLETED,
      });
      const sumQb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ sum: '50000' }),
      };
      mockContributionRepo.createQueryBuilder.mockReturnValue(sumQb);

      await service.confirmContribution('contrib-1', { id: 'admin-1' } as any);

      expect(mockPledgeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: PledgeStatus.COMPLETED }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'PLEDGE_AUTO_COMPLETED',
        expect.any(Object),
      );
    });
  });

  describe('declineContribution', () => {
    it('throws NotFoundException if no pending contribution matches', async () => {
      mockContributionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.declineContribution(
          'contrib-1',
          { financeNote: 'No matching bank transfer found.' },
          { id: 'admin-1' } as any,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('declines with a finance note and emails the member', async () => {
      const contribution = {
        id: 'contrib-1',
        amount: 5000,
        paymentDate: '2026-07-01',
        status: PledgeContributionStatus.PENDING,
        pledge: {
          id: 'pledge-1',
          member: { email: 'a@b.com', firstname: 'ada' },
          campaign: { name: 'Building Fund' },
        },
      };
      mockContributionRepo.findOne.mockResolvedValue(contribution);
      mockContributionRepo.save.mockImplementation((c) => Promise.resolve(c));

      const result = await service.declineContribution(
        'contrib-1',
        { financeNote: 'No matching bank transfer found.' },
        { id: 'admin-1' } as any,
      );

      expect(result.status).toBe(PledgeContributionStatus.DECLINED);
      expect(result.financeNote).toBe('No matching bank transfer found.');
      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
        'a@b.com',
        expect.any(String),
        'pledge-contribution-declined',
        expect.objectContaining({
          financeNote: 'No matching bank transfer found.',
        }),
        undefined,
        expect.any(String),
      );
    });
  });
});
