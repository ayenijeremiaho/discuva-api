import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CacheService } from './utility/service/cache.service';
import { ConfigService } from '@nestjs/config';

const mockDataSource = { query: jest.fn().mockResolvedValue([]) };
const mockCacheService = { ping: jest.fn().mockResolvedValue(undefined) };
const CONFIG_DEFAULTS: Record<string, string> = {
  POSTMAN_URL: 'https://postman.example.com',
  PRODUCT_NAME: 'Discuva',
  CHURCH_NAME: 'RCCG Discovery Centre',
  CHURCH_ADDRESS: '62 Igi Olugbin Street, Bariga. Lagos, Nigeria',
};
const mockConfigService = {
  get: jest.fn().mockImplementation((key: string) => CONFIG_DEFAULTS[key]),
};

describe('AppController', () => {
  let appController: AppController;
  let appService: AppService;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
    appService = app.get<AppService>(AppService);
  });

  describe('root', () => {
    it('should serve the homepage as HTML', () => {
      const mockRes = { setHeader: jest.fn(), end: jest.fn() };
      appController.getHomepage(mockRes as any);
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/html; charset=utf-8',
      );
      expect(mockRes.end).toHaveBeenCalledWith(
        expect.stringContaining('Discuva'),
      );
    });

    it('homepage contains rendered markdown content', () => {
      const html = appService.getHomepage();
      expect(html).toContain('<h');
      expect(html).toContain('TECH_DOC.md');
    });
  });

  describe('docs redirect', () => {
    it('should redirect /docs to /', () => {
      const mockRes = { redirect: jest.fn() };
      appController.redirectDocs(mockRes as any);
      expect(mockRes.redirect).toHaveBeenCalledWith(301, '/');
    });
  });

  describe('health', () => {
    it('returns ok when db and redis are healthy', async () => {
      const result = await appController.health();
      expect(result.status).toBe('ok');
      expect(typeof result.uptime).toBe('number');
    });
  });
});
