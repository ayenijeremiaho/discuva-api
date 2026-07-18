import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { AnnualGivingStatementScheduler } from './annual-giving-statement.scheduler';
import { Member } from '../../member/entity/member.entity';
import { TitheRecord } from '../../tithe/entity/tithe-record.entity';
import { PledgeContribution } from '../entity/pledge-contribution.entity';
import { CacheService } from '../../utility/service/cache.service';
import { UtilityService } from '../../utility/service/utility.service';

const mockCacheService = {
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn(),
};

const mockUtilityService = {
  sendEmailWithTemplate: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string) => (key === 'CURRENCY_CODE' ? 'NGN' : undefined)),
};

const mockMemberRepo = {
  findOne: jest.fn(),
  findBy: jest.fn(),
};

const makeQb = (
  rows: { memberId: string; total: string; lineCount: string }[],
) => ({
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  getRawMany: jest.fn().mockResolvedValue(rows),
});

const mockTitheRecordRepo = { createQueryBuilder: jest.fn() };
const mockContributionRepo = { createQueryBuilder: jest.fn() };

describe('AnnualGivingStatementScheduler', () => {
  let scheduler: AnnualGivingStatementScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnualGivingStatementScheduler,
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        {
          provide: getRepositoryToken(TitheRecord),
          useValue: mockTitheRecordRepo,
        },
        {
          provide: getRepositoryToken(PledgeContribution),
          useValue: mockContributionRepo,
        },
        { provide: CacheService, useValue: mockCacheService },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    scheduler = module.get<AnnualGivingStatementScheduler>(
      AnnualGivingStatementScheduler,
    );
  });

  describe('sendForMember (exercises fetchMemberTotals)', () => {
    it('sums tithes only when the member has no confirmed pledge contributions', async () => {
      mockTitheRecordRepo.createQueryBuilder.mockReturnValue(
        makeQb([{ memberId: 'm1', total: '5000.00', lineCount: '2' }]),
      );
      mockContributionRepo.createQueryBuilder.mockReturnValue(makeQb([]));
      mockMemberRepo.findOne.mockResolvedValue({
        id: 'm1',
        email: 'ada@test.com',
        firstname: 'Ada',
        lastname: 'Obi',
      });

      const result = await scheduler.sendForMember('m1');

      expect(result.sent).toBe(true);
      expect(result.total).toBe(5000);
    });

    it('sums confirmed pledge contributions only when the member has no tithes', async () => {
      mockTitheRecordRepo.createQueryBuilder.mockReturnValue(makeQb([]));
      mockContributionRepo.createQueryBuilder.mockReturnValue(
        makeQb([{ memberId: 'm1', total: '10000.00', lineCount: '1' }]),
      );
      mockMemberRepo.findOne.mockResolvedValue({
        id: 'm1',
        email: 'ada@test.com',
        firstname: 'Ada',
        lastname: 'Obi',
      });

      const result = await scheduler.sendForMember('m1');

      expect(result.sent).toBe(true);
      expect(result.total).toBe(10000);
    });

    it('combines tithes and confirmed pledge contributions for the same member', async () => {
      mockTitheRecordRepo.createQueryBuilder.mockReturnValue(
        makeQb([{ memberId: 'm1', total: '5000.00', lineCount: '2' }]),
      );
      mockContributionRepo.createQueryBuilder.mockReturnValue(
        makeQb([{ memberId: 'm1', total: '10000.00', lineCount: '1' }]),
      );
      mockMemberRepo.findOne.mockResolvedValue({
        id: 'm1',
        email: 'ada@test.com',
        firstname: 'Ada',
        lastname: 'Obi',
      });

      const result = await scheduler.sendForMember('m1');

      expect(result.total).toBe(15000);
      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
        'ada@test.com',
        'Annual Giving Statement',
        'annual-giving-statement',
        expect.objectContaining({
          total: '15000.00',
          lineCount: 3,
          currency: 'NGN',
        }),
      );
    });

    it('excludes contributions that are only PENDING or DECLINED (query itself filters to CONFIRMED)', async () => {
      // The contribution query builder only ever returns CONFIRMED rows by construction
      // (status = CONFIRMED is baked into the WHERE clause) — simulate the case where
      // a PENDING/DECLINED contribution exists but never surfaces in the aggregated rows.
      mockTitheRecordRepo.createQueryBuilder.mockReturnValue(makeQb([]));
      const contributionQb = makeQb([]);
      mockContributionRepo.createQueryBuilder.mockReturnValue(contributionQb);
      mockMemberRepo.findOne.mockResolvedValue({
        id: 'm1',
        email: 'ada@test.com',
        firstname: 'Ada',
        lastname: 'Obi',
      });

      const result = await scheduler.sendForMember('m1');

      expect(contributionQb.where).toHaveBeenCalledWith('pc.status = :status', {
        status: 'CONFIRMED',
      });
      expect(result.sent).toBe(false);
      expect(result.total).toBe(0);
    });

    it('reports no giving with a clear message when totals are zero', async () => {
      mockTitheRecordRepo.createQueryBuilder.mockReturnValue(makeQb([]));
      mockContributionRepo.createQueryBuilder.mockReturnValue(makeQb([]));

      const result = await scheduler.sendForMember('m1');

      expect(result.sent).toBe(false);
      expect(result.message).toContain('no recorded giving');
      expect(mockUtilityService.sendEmailWithTemplate).not.toHaveBeenCalled();
    });
  });
});
