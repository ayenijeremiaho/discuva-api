import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { FinanceReportService } from './finance-report.service';
import { JournalEntry } from '../entity/journal-entry.entity';
import { JournalEntryLine } from '../entity/journal-entry-line.entity';
import { Account } from '../entity/account.entity';
import { Budget } from '../entity/budget.entity';
import { Pledge } from '../entity/pledge.entity';
import { PledgeCampaign } from '../entity/pledge-campaign.entity';
import { Fund } from '../entity/fund.entity';
import { AccountingPeriod } from '../entity/accounting-period.entity';
import { PettyCashReplenishment } from '../entity/petty-cash-replenishment.entity';

const makeQb = () => ({
  createQueryBuilder: jest.fn(),
  innerJoin: jest.fn().mockReturnThis(),
  innerJoinAndSelect: jest.fn().mockReturnThis(),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
  getRawMany: jest.fn().mockResolvedValue([]),
  getRawOne: jest.fn().mockResolvedValue(undefined),
});

const mockEntryRepo = { count: jest.fn() };
const mockLineRepo = { createQueryBuilder: jest.fn() };
const mockAccountRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  createQueryBuilder: jest.fn(),
};
const mockBudgetRepo = { findOne: jest.fn(), find: jest.fn() };
const mockPledgeRepo = {
  find: jest.fn(),
  createQueryBuilder: jest.fn(),
  query: jest.fn(),
};
const mockCampaignRepo = { findOne: jest.fn() };
const mockFundRepo = {};
const mockPeriodRepo = {};
const mockPettyCashRepo = { count: jest.fn() };

describe('FinanceReportService', () => {
  let service: FinanceReportService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceReportService,
        { provide: getRepositoryToken(JournalEntry), useValue: mockEntryRepo },
        {
          provide: getRepositoryToken(JournalEntryLine),
          useValue: mockLineRepo,
        },
        { provide: getRepositoryToken(Account), useValue: mockAccountRepo },
        { provide: getRepositoryToken(Budget), useValue: mockBudgetRepo },
        { provide: getRepositoryToken(Pledge), useValue: mockPledgeRepo },
        {
          provide: getRepositoryToken(PledgeCampaign),
          useValue: mockCampaignRepo,
        },
        { provide: getRepositoryToken(Fund), useValue: mockFundRepo },
        {
          provide: getRepositoryToken(AccountingPeriod),
          useValue: mockPeriodRepo,
        },
        {
          provide: getRepositoryToken(PettyCashReplenishment),
          useValue: mockPettyCashRepo,
        },
      ],
    }).compile();

    service = module.get<FinanceReportService>(FinanceReportService);
  });

  describe('pledgeSummary', () => {
    beforeEach(() => {
      mockCampaignRepo.findOne.mockResolvedValue({
        id: 'camp-1',
        name: 'Building Fund',
        fund: { name: 'Building' },
      });
      mockPledgeRepo.query.mockResolvedValue([
        {
          status: 'ACTIVE',
          pledged: '100000.00',
          paid: '40000.00',
          paid_in_period: '15000.00',
          member: 'Ada Obi',
          guest_name: null,
        },
        {
          status: 'ACTIVE',
          pledged: '50000.00',
          paid: '60000.00',
          paid_in_period: '0',
          member: null,
          guest_name: 'Visitor',
        },
      ]);
    });

    it('returns flat rows with paid and outstanding, and range totals when dates are given', async () => {
      const result: any = await service.pledgeSummary(
        'camp-1',
        '2026-09-01',
        '2026-09-30',
      );

      const [, params] = mockPledgeRepo.query.mock.calls[0];
      expect(params).toEqual([
        'camp-1',
        'CONFIRMED',
        '2026-09-01',
        '2026-09-30',
      ]);
      expect(result).toMatchObject({
        campaign: 'Building Fund',
        fund: 'Building',
        period: '2026-09-01 to 2026-09-30',
        pledgeCount: '2',
        totalPledged: 150000,
        totalPaid: 100000,
        paidInPeriod: 15000,
        outstanding: 60000,
      });
      expect(result.pledges[0]).toEqual({
        member: 'Ada Obi',
        status: 'ACTIVE',
        pledged: 100000,
        paid: 40000,
        paidInPeriod: 15000,
        outstanding: 60000,
      });
      expect(result.pledges[1]).toMatchObject({
        member: 'Visitor',
        outstanding: 0,
      });
    });

    it('leaves out period figures when no range is given', async () => {
      const result: any = await service.pledgeSummary('camp-1');
      expect(result.period).toBeUndefined();
      expect(result.paidInPeriod).toBeUndefined();
      expect(result.pledges[0].paidInPeriod).toBeUndefined();
      expect(mockPledgeRepo.query.mock.calls[0][1]).toEqual([
        'camp-1',
        'CONFIRMED',
        null,
        null,
      ]);
    });

    it('404s for an unknown campaign', async () => {
      mockCampaignRepo.findOne.mockResolvedValue(null);
      await expect(service.pledgeSummary('nope')).rejects.toThrow(
        'Campaign not found.',
      );
    });
  });

  describe('cashFlow', () => {
    it('throws NotFoundException when the account does not exist', async () => {
      mockAccountRepo.findOne.mockResolvedValue(null);
      await expect(service.cashFlow('acct-x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('defaults to a bounded ~365-day lookback instead of the full history when fromDate is omitted', async () => {
      mockAccountRepo.findOne.mockResolvedValue({
        id: 'acct-1',
        name: 'Main',
        currentBalance: 100,
      });
      const qb = makeQb();
      mockLineRepo.createQueryBuilder.mockReturnValue(qb);

      const result = (await service.cashFlow('acct-1')) as {
        fromDate: string;
        toDate: string | null;
      };

      const call = qb.andWhere.mock.calls.find(
        (c: unknown[]) => c[0] === 'je.date >= :fromDate',
      );
      expect(call).toBeDefined();
      const usedFrom = new Date((call![1] as { fromDate: string }).fromDate);
      const daysAgo = (Date.now() - usedFrom.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysAgo).toBeGreaterThan(364);
      expect(daysAgo).toBeLessThan(366);
      expect(result.fromDate).toBe((call![1] as { fromDate: string }).fromDate);
      expect(result.toDate).toBeNull();
    });

    it('uses the caller-supplied fromDate as-is instead of the default', async () => {
      mockAccountRepo.findOne.mockResolvedValue({
        id: 'acct-1',
        name: 'Main',
        currentBalance: 100,
      });
      const qb = makeQb();
      mockLineRepo.createQueryBuilder.mockReturnValue(qb);

      await service.cashFlow('acct-1', '2020-01-01', '2020-12-31');

      expect(qb.andWhere).toHaveBeenCalledWith('je.date >= :fromDate', {
        fromDate: '2020-01-01',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('je.date <= :toDate', {
        toDate: '2020-12-31',
      });
    });
  });

  describe('accountLedger', () => {
    it('throws NotFoundException when the account does not exist', async () => {
      mockAccountRepo.findOne.mockResolvedValue(null);
      await expect(service.accountLedger('acct-x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('defaults to a bounded ~365-day lookback instead of the full history when fromDate is omitted', async () => {
      mockAccountRepo.findOne.mockResolvedValue({
        id: 'acct-1',
        name: 'Main',
      });
      const qb = makeQb();
      mockLineRepo.createQueryBuilder.mockReturnValue(qb);

      await service.accountLedger('acct-1');

      const call = qb.andWhere.mock.calls.find(
        (c: unknown[]) => c[0] === 'je.date >= :fromDate',
      );
      expect(call).toBeDefined();
      const usedFrom = new Date((call![1] as { fromDate: string }).fromDate);
      const daysAgo = (Date.now() - usedFrom.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysAgo).toBeGreaterThan(364);
      expect(daysAgo).toBeLessThan(366);
    });
  });

  describe('memberGiving', () => {
    it('defaults to a bounded ~365-day lookback when neither periodId nor fromDate is given', async () => {
      const qb = makeQb();
      mockLineRepo.createQueryBuilder.mockReturnValue(qb);

      await service.memberGiving('member-1');

      const call = qb.andWhere.mock.calls.find(
        (c: unknown[]) => c[0] === 'je.date >= :fromDate',
      );
      expect(call).toBeDefined();
      const usedFrom = new Date((call![1] as { fromDate: string }).fromDate);
      const daysAgo = (Date.now() - usedFrom.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysAgo).toBeGreaterThan(364);
      expect(daysAgo).toBeLessThan(366);
    });

    it('does not apply the default lookback when a periodId already bounds the query', async () => {
      const qb = makeQb();
      mockLineRepo.createQueryBuilder.mockReturnValue(qb);

      await service.memberGiving('member-1', 'period-1');

      const call = qb.andWhere.mock.calls.find(
        (c: unknown[]) => c[0] === 'je.date >= :fromDate',
      );
      expect(call).toBeUndefined();
    });

    it('uses the caller-supplied fromDate as-is instead of the default', async () => {
      const qb = makeQb();
      mockLineRepo.createQueryBuilder.mockReturnValue(qb);

      await service.memberGiving('member-1', undefined, '2020-01-01');

      expect(qb.andWhere).toHaveBeenCalledWith('je.date >= :fromDate', {
        fromDate: '2020-01-01',
      });
    });
  });
});
