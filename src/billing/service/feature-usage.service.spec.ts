import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { FeatureUsageService } from './feature-usage.service';

const mockDataSource = { query: jest.fn() };

describe('FeatureUsageService', () => {
  let service: FeatureUsageService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureUsageService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();
    service = module.get(FeatureUsageService);
  });

  describe('tryConsume', () => {
    it('returns true and issues the upsert when the row is returned (still under the cap)', async () => {
      mockDataSource.query.mockResolvedValue([{ count: 1 }]);

      const result = await service.tryConsume('tenant-1', 'sms', 3);

      expect(result).toBe(true);
      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (tenant_id, feature)'),
        [expect.any(String), 'tenant-1', 'sms', 3],
      );
    });

    it('returns false when the conditional upsert matches no row (cap already hit)', async () => {
      mockDataSource.query.mockResolvedValue([]);

      const result = await service.tryConsume('tenant-1', 'sms', 3);

      expect(result).toBe(false);
    });

    it('returns false without querying when limit is zero or negative', async () => {
      const result = await service.tryConsume('tenant-1', 'sms', 0);

      expect(result).toBe(false);
      expect(mockDataSource.query).not.toHaveBeenCalled();
    });
  });

  describe('getUsage', () => {
    it('returns the stored count', async () => {
      mockDataSource.query.mockResolvedValue([{ count: 2 }]);
      expect(await service.getUsage('tenant-1', 'sms')).toBe(2);
    });

    it('returns 0 when no row exists yet', async () => {
      mockDataSource.query.mockResolvedValue([]);
      expect(await service.getUsage('tenant-1', 'sms')).toBe(0);
    });
  });
});
