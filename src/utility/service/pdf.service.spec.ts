import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { GivingStatementLine, PdfService } from './pdf.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { CacheService } from './cache.service';
import { SessionReport } from '../../service-programme/service/service-session.service';
import { Member } from '../../member/entity/member.entity';

const mockTenantRepo = { findOneBy: jest.fn() };
const mockCacheService = {
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
  key: jest.fn().mockReturnValue('cache-key'),
  getOrSet: jest
    .fn()
    .mockImplementation((_key: string, fn: () => Promise<unknown>) => fn()),
};
const mockCls = { get: jest.fn() };

const ENV_DEFAULTS: Record<string, string | number> = {
  CHURCH_NAME: 'Env Default Church',
  CHURCH_ADDRESS: '1 Env Default Rd',
  CHURCH_TAGLINE: 'Env default tagline',
  CURRENCY_CODE: 'USD',
  CURRENCY_LOCALE: 'en-US',
  CACHE_TTL_REFERENCE_SECONDS: 300,
};
const mockConfigService = { get: jest.fn((key: string) => ENV_DEFAULTS[key]) };

const baseSessionReport: SessionReport = {
  sessionCode: 'SESS-1',
  programme: { id: 'p1', serviceSlotName: 'First Service' },
  status: 'completed',
  startedAt: new Date('2026-01-04T08:00:00Z'),
  endedAt: new Date('2026-01-04T09:00:00Z'),
  totalDurationMinutes: 60,
  totalPauseDurationSeconds: 0,
  completedSlots: 2,
  totalSlots: 2,
  completionRate: 100,
  totalAllocatedMinutes: 60,
  slotVarianceMinutes: 0,
  slots: [],
  pauseCount: 0,
  pauses: [],
};

describe('PdfService', () => {
  let service: PdfService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockImplementation(
      (key: string) => ENV_DEFAULTS[key],
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PdfService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ClsService, useValue: mockCls },
        { provide: CacheService, useValue: mockCacheService },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
      ],
    }).compile();
    service = module.get(PdfService);
  });

  function pdfText(buffer: Buffer): string {
    return buffer.toString('latin1');
  }

  describe('generateSessionReport (church_name/address via drawPageHeader/Footer)', () => {
    it("renders the current tenant's own name and address, not the env default", async () => {
      mockCls.get.mockReturnValue('tenant-1');
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'tenant-1',
        name: 'St. Example Church',
        address: '42 Tenant Ave',
        tagline: 'Tenant tagline',
        currency: 'NGN',
      });

      const buffer = await service.generateSessionReport(baseSessionReport);
      const text = pdfText(buffer);

      expect(text).toContain('St. Example Church');
      expect(text).toContain('42 Tenant Ave');
      expect(text).not.toContain(ENV_DEFAULTS.CHURCH_NAME);
    });

    it('falls back to env defaults when there is no tenant CLS context', async () => {
      mockCls.get.mockReturnValue(undefined);

      const buffer = await service.generateSessionReport(baseSessionReport);
      const text = pdfText(buffer);

      expect(mockTenantRepo.findOneBy).not.toHaveBeenCalled();
      expect(text).toContain(ENV_DEFAULTS.CHURCH_NAME as string);
      expect(text).toContain(ENV_DEFAULTS.CHURCH_ADDRESS as string);
    });

    it('falls back to the env default only for a field the tenant left unset', async () => {
      mockCls.get.mockReturnValue('tenant-1');
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'tenant-1',
        name: 'St. Example Church',
        address: null,
        tagline: null,
        currency: null,
      });

      const buffer = await service.generateSessionReport(baseSessionReport);
      const text = pdfText(buffer);

      expect(text).toContain('St. Example Church');
      expect(text).toContain(ENV_DEFAULTS.CHURCH_ADDRESS as string);
    });
  });

  describe('generateGivingStatement (currency via inline branding.currencyCode)', () => {
    const member = {
      firstname: 'Jane',
      lastname: 'Doe',
      email: 'jane@example.com',
      phoneNumber: '08000000000',
    } as Member;
    const lines: GivingStatementLine[] = [
      {
        amount: 5000,
        paymentDate: '2026-01-15',
        type: 'Tithe',
        bankName: 'Test Bank',
        reference: 'REF-1',
      },
    ];

    it("uses the tenant's own currency, not the env default", async () => {
      mockCls.get.mockReturnValue('tenant-1');
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'tenant-1',
        name: 'St. Example Church',
        address: '42 Tenant Ave',
        tagline: null,
        currency: 'NGN',
      });

      const buffer = await service.generateGivingStatement(member, lines);
      const text = pdfText(buffer);

      expect(text).toContain('NGN');
      expect(text).not.toContain(`(${ENV_DEFAULTS.CURRENCY_CODE})`);
    });

    it('renders the Type column for a mix of giving purposes', async () => {
      mockCls.get.mockReturnValue('tenant-1');
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'tenant-1',
        name: 'St. Example Church',
        address: '42 Tenant Ave',
        tagline: null,
        currency: 'NGN',
      });
      const mixedLines: GivingStatementLine[] = [
        {
          amount: 5000,
          paymentDate: '2026-01-15',
          type: 'Tithe',
          bankName: 'Test Bank',
          reference: 'REF-1',
        },
        {
          amount: 10000,
          paymentDate: '2026-01-20',
          type: 'General Giving',
          bankName: null,
          reference: 'giving_abc',
        },
        {
          amount: 25000,
          paymentDate: '2026-01-25',
          type: 'Building Fund',
          bankName: null,
          reference: 'giving_def',
        },
        {
          amount: 15000,
          paymentDate: '2026-01-28',
          type: 'Pledge: Roof Repair Fund',
          bankName: null,
          reference: 'giving_ghi',
        },
      ];

      const buffer = await service.generateGivingStatement(member, mixedLines);
      const text = pdfText(buffer);

      expect(text).toContain('Giving Statement');
      expect(text).toContain('Tithe');
      expect(text).toContain('General Giving');
      expect(text).toContain('Building Fund');
      // Checked as a short substring rather than the full concatenated
      // label — a long Type value can wrap/kern across the narrow
      // autoTable column in a way that breaks a single contiguous match
      // in the raw PDF byte stream.
      expect(text).toContain('Pledge:');
      expect(text).toContain('Roof');
    });
  });

  it('resolves branding through the cache, not a fresh DB lookup per call', async () => {
    mockCls.get.mockReturnValue('tenant-1');
    mockCacheService.getOrSet.mockResolvedValue({
      id: 'tenant-1',
      name: 'Cached Church',
      address: 'Cached Address',
      tagline: null,
      currency: 'NGN',
    });

    const buffer = await service.generateSessionReport(baseSessionReport);

    expect(mockCacheService.getOrSet).toHaveBeenCalledWith(
      'tenant-branding:tenant-1',
      expect.any(Function),
      300,
    );
    expect(mockTenantRepo.findOneBy).not.toHaveBeenCalled();
    expect(pdfText(buffer)).toContain('Cached Church');
  });
});
