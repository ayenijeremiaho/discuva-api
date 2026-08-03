import { Test, TestingModule } from '@nestjs/testing';
import { PlatformAnalyticsController } from './platform-analytics.controller';
import { PlatformAnalyticsService } from '../service/platform-analytics.service';
import { PlatformAdminGuard } from '../guard/platform-admin.guard';

const mockAnalyticsService = {
  getOverview: jest.fn(),
  getGrowth: jest.fn(),
  getRevenue: jest.fn(),
  getEngagement: jest.fn(),
  getChurn: jest.fn(),
  getAdoption: jest.fn(),
};

describe('PlatformAnalyticsController', () => {
  let controller: PlatformAnalyticsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlatformAnalyticsController],
      providers: [
        { provide: PlatformAnalyticsService, useValue: mockAnalyticsService },
      ],
    })
      .overrideGuard(PlatformAdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(PlatformAnalyticsController);
  });

  it('getOverview delegates with no params', () => {
    controller.getOverview();
    expect(mockAnalyticsService.getOverview).toHaveBeenCalledWith();
  });

  it('getGrowth passes through the period/months query', () => {
    controller.getGrowth({ period: 'weekly', months: 6 });
    expect(mockAnalyticsService.getGrowth).toHaveBeenCalledWith('weekly', 6);
  });

  it('getRevenue passes through the period/months query', () => {
    controller.getRevenue({ period: 'daily', months: 1 });
    expect(mockAnalyticsService.getRevenue).toHaveBeenCalledWith('daily', 1);
  });

  it('getEngagement delegates with no params', () => {
    controller.getEngagement();
    expect(mockAnalyticsService.getEngagement).toHaveBeenCalledWith();
  });

  it('getChurn passes through the period/months query', () => {
    controller.getChurn({ period: 'monthly', months: 24 });
    expect(mockAnalyticsService.getChurn).toHaveBeenCalledWith('monthly', 24);
  });

  it('getAdoption delegates with no params', () => {
    controller.getAdoption();
    expect(mockAnalyticsService.getAdoption).toHaveBeenCalledWith();
  });
});
