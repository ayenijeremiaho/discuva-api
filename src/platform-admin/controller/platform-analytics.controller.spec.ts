import { Test, TestingModule } from '@nestjs/testing';
import { PlatformAnalyticsController } from './platform-analytics.controller';
import { PlatformAnalyticsService } from '../service/platform-analytics.service';
import { PlatformAdminGuard } from '../guard/platform-admin.guard';
import { CacheService } from '../../utility/service/cache.service';

const mockAnalyticsService = {
  getOverview: jest.fn().mockResolvedValue({ totalTenants: 3 }),
  getGrowth: jest.fn().mockResolvedValue({}),
  getRevenue: jest.fn().mockResolvedValue({}),
  getEngagement: jest.fn().mockResolvedValue({}),
  getChurn: jest.fn().mockResolvedValue({}),
  getAdoption: jest.fn().mockResolvedValue({}),
  getGiving: jest.fn().mockResolvedValue({}),
};
const mockCache = {
  getGlobal: jest.fn().mockResolvedValue(undefined),
  setGlobal: jest.fn().mockResolvedValue(undefined),
};

describe('PlatformAnalyticsController', () => {
  let controller: PlatformAnalyticsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCache.getGlobal.mockResolvedValue(undefined);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlatformAnalyticsController],
      providers: [
        { provide: PlatformAnalyticsService, useValue: mockAnalyticsService },
        { provide: CacheService, useValue: mockCache },
      ],
    })
      .overrideGuard(PlatformAdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(PlatformAnalyticsController);
  });

  it('passes each section its period and months', async () => {
    await controller.getGrowth({ period: 'weekly', months: 6 });
    await controller.getRevenue({ period: 'daily', months: 1 });
    await controller.getChurn({ period: 'monthly', months: 24 });
    await controller.getGiving({ period: 'monthly', months: 3 });
    expect(mockAnalyticsService.getGrowth).toHaveBeenCalledWith('weekly', 6);
    expect(mockAnalyticsService.getRevenue).toHaveBeenCalledWith('daily', 1);
    expect(mockAnalyticsService.getChurn).toHaveBeenCalledWith('monthly', 24);
    expect(mockAnalyticsService.getGiving).toHaveBeenCalledWith('monthly', 3);
  });

  it('keeps each section for 10 minutes, per period and months', async () => {
    await controller.getOverview({});
    await controller.getGrowth({ period: 'weekly', months: 6 });
    expect(mockCache.setGlobal).toHaveBeenCalledWith(
      'platform-analytics:overview',
      { totalTenants: 3 },
      600,
    );
    expect(mockCache.setGlobal).toHaveBeenCalledWith(
      'platform-analytics:growth:weekly:6',
      {},
      600,
    );
  });

  it('serves a cached section without asking the database', async () => {
    mockCache.getGlobal.mockResolvedValue({ totalTenants: 9 });
    await expect(controller.getOverview({})).resolves.toEqual({
      totalTenants: 9,
    });
    await controller.getEngagement({});
    await controller.getAdoption({});
    expect(mockAnalyticsService.getOverview).not.toHaveBeenCalled();
    expect(mockAnalyticsService.getEngagement).not.toHaveBeenCalled();
    expect(mockAnalyticsService.getAdoption).not.toHaveBeenCalled();
  });

  it('Refresh skips the cache and stores the fresh figures', async () => {
    mockCache.getGlobal.mockResolvedValue({ totalTenants: 9 });
    await expect(controller.getOverview({ fresh: true })).resolves.toEqual({
      totalTenants: 3,
    });
    expect(mockCache.getGlobal).not.toHaveBeenCalled();
    expect(mockCache.setGlobal).toHaveBeenCalled();
  });
});
