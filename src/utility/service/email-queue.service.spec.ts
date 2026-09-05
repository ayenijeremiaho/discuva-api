import * as fs from 'node:fs';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { EmailQueueService } from './email-queue.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { CacheService } from './cache.service';
import { EmailCategorySettingsService } from '../../email-category-settings/service/email-category-settings.service';
import { EmailCategory } from '../email-provider/email-category.enum';

jest.mock('node:fs');

const TEMPLATE =
  '<p>{{church_name}} | {{church_address}} | {{logo_url}} | {{product_name}}</p>' +
  '{{#if support_email}}<p>Contact: {{support_email}}</p>{{/if}}' +
  '<p>{{login_url}} | {{admin_login_url}}</p>';

const mockQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
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
const mockCls = {
  get: jest.fn(),
  isActive: jest.fn().mockReturnValue(true),
  getId: jest.fn().mockReturnValue('correlation-1'),
};

const ENV_DEFAULTS: Record<string, string | number> = {
  CHURCH_NAME: 'Env Default Church',
  CHURCH_ADDRESS: '1 Env Default Rd',
  LOGO_URL: 'https://env.example.com/logo.png',
  PRODUCT_NAME: 'Discuva',
  CACHE_TTL_REFERENCE_SECONDS: 300,
  LOGIN_URL: 'https://discuva.org/login',
  ADMIN_LOGIN_URL: 'https://discuva.org/admin/login',
};
const mockConfigService = {
  get: jest.fn((key: string): string | number | boolean => ENV_DEFAULTS[key]),
};
const mockEmailCategorySettingsService = {
  isEnabled: jest.fn().mockResolvedValue(true),
};

describe('EmailQueueService', () => {
  let service: EmailQueueService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockImplementation(
      (key: string) => ENV_DEFAULTS[key],
    );
    // clearAllMocks() only resets calls/instances, not an implementation
    // installed via mockResolvedValue/mockImplementation — restore the
    // default cache passthrough explicitly so an override in one test
    // (e.g. the "resolves through the cache" test below) can't leak into
    // every test that runs after it.
    mockCacheService.getOrSet.mockImplementation(
      (_key: string, fn: () => Promise<unknown>) => fn(),
    );
    mockEmailCategorySettingsService.isEnabled.mockResolvedValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(TEMPLATE);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailQueueService,
        { provide: getQueueToken('email'), useValue: mockQueue },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ClsService, useValue: mockCls },
        { provide: CacheService, useValue: mockCacheService },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        {
          provide: EmailCategorySettingsService,
          useValue: mockEmailCategorySettingsService,
        },
      ],
    }).compile();
    service = module.get(EmailQueueService);
  });

  function sentHtml(): string {
    return mockQueue.add.mock.calls[0][1].html;
  }

  it("renders the current tenant's own branding into the template", async () => {
    mockCls.get.mockReturnValue('tenant-1');
    mockTenantRepo.findOneBy.mockResolvedValue({
      id: 'tenant-1',
      name: 'St. Example Church',
      address: '42 Tenant Ave',
      logoUrl: 'https://tenant.example.com/logo.png',
    });

    await service.queueEmailWithTemplate('a@b.com', 'Subject', 'welcome', {});

    const html = sentHtml();
    expect(html).toContain('St. Example Church');
    expect(html).toContain('42 Tenant Ave');
    expect(html).toContain('https://tenant.example.com/logo.png');
  });

  it('falls back to the env default only for a field the tenant left unset', async () => {
    mockCls.get.mockReturnValue('tenant-1');
    mockTenantRepo.findOneBy.mockResolvedValue({
      id: 'tenant-1',
      name: 'St. Example Church',
      address: '42 Tenant Ave',
      logoUrl: null,
    });

    await service.queueEmailWithTemplate('a@b.com', 'Subject', 'welcome', {});

    const html = sentHtml();
    expect(html).toContain('St. Example Church');
    expect(html).toContain(ENV_DEFAULTS.LOGO_URL);
  });

  it('falls back entirely to env defaults when there is no tenant CLS context', async () => {
    mockCls.get.mockReturnValue(undefined);

    await service.queueEmailWithTemplate('a@b.com', 'Subject', 'welcome', {});

    expect(mockTenantRepo.findOneBy).not.toHaveBeenCalled();
    const html = sentHtml();
    expect(html).toContain(ENV_DEFAULTS.CHURCH_NAME);
    expect(html).toContain(ENV_DEFAULTS.CHURCH_ADDRESS);
    expect(html).toContain(ENV_DEFAULTS.LOGO_URL);
  });

  it('always renders product_name from env, regardless of tenant', async () => {
    mockCls.get.mockReturnValue('tenant-1');
    mockTenantRepo.findOneBy.mockResolvedValue({
      id: 'tenant-1',
      name: 'St. Example Church',
      address: '42 Tenant Ave',
      logoUrl: 'https://tenant.example.com/logo.png',
    });

    await service.queueEmailWithTemplate('a@b.com', 'Subject', 'welcome', {});

    expect(sentHtml()).toContain(ENV_DEFAULTS.PRODUCT_NAME);
  });

  it('falls back to env defaults when the tenant row cannot be found', async () => {
    mockCls.get.mockReturnValue('tenant-missing');
    mockTenantRepo.findOneBy.mockResolvedValue(null);

    await service.queueEmailWithTemplate('a@b.com', 'Subject', 'welcome', {});

    expect(sentHtml()).toContain(ENV_DEFAULTS.CHURCH_NAME);
  });

  it("renders the tenant's support email when set", async () => {
    mockCls.get.mockReturnValue('tenant-1');
    mockTenantRepo.findOneBy.mockResolvedValue({
      id: 'tenant-1',
      name: 'St. Example Church',
      address: '42 Tenant Ave',
      logoUrl: null,
      supportEmail: 'help@stexample.org',
    });

    await service.queueEmailWithTemplate('a@b.com', 'Subject', 'welcome', {});

    expect(sentHtml()).toContain('Contact: help@stexample.org');
  });

  it('omits the support email line entirely when the tenant has not set one — no fabricated fallback', async () => {
    mockCls.get.mockReturnValue('tenant-1');
    mockTenantRepo.findOneBy.mockResolvedValue({
      id: 'tenant-1',
      name: 'St. Example Church',
      address: '42 Tenant Ave',
      logoUrl: null,
      supportEmail: null,
    });

    await service.queueEmailWithTemplate('a@b.com', 'Subject', 'welcome', {});

    expect(sentHtml()).not.toContain('Contact:');
  });

  it('never falls back to an env-level support email when there is no tenant CLS context', async () => {
    mockCls.get.mockReturnValue(undefined);

    await service.queueEmailWithTemplate('a@b.com', 'Subject', 'welcome', {});

    expect(sentHtml()).not.toContain('Contact:');
  });

  it('resolves branding through the cache, not a fresh DB lookup per call', async () => {
    mockCls.get.mockReturnValue('tenant-1');
    mockCacheService.getOrSet.mockResolvedValue({
      id: 'tenant-1',
      name: 'Cached Church',
      address: 'Cached Address',
      logoUrl: 'https://cached.example.com/logo.png',
    });

    await service.queueEmailWithTemplate('a@b.com', 'Subject', 'welcome', {});

    expect(mockCacheService.getOrSet).toHaveBeenCalledWith(
      'tenant-branding:tenant-1',
      expect.any(Function),
      300,
    );
    expect(mockTenantRepo.findOneBy).not.toHaveBeenCalled();
    expect(sentHtml()).toContain('Cached Church');
  });

  it("carries the current tenant's subdomain in login_url (host-prepended, member's real wildcard) and admin_login_url (query param, admin has no wildcard)", async () => {
    mockCls.get.mockReturnValue('tenant-1');
    mockTenantRepo.findOneBy.mockResolvedValue({
      id: 'tenant-1',
      subdomain: 'church-alpha',
      name: 'St. Example Church',
      address: '42 Tenant Ave',
      logoUrl: null,
    });

    await service.queueEmailWithTemplate('a@b.com', 'Subject', 'welcome', {});

    const html = sentHtml();
    expect(html).toContain('https://church-alpha.discuva.org/login');
    // Handlebars HTML-escapes the double-stashed template var, so "="
    // becomes "&#x3D;" in the rendered output — this is what the recipient
    // actually receives (the template must reference {{{admin_login_url}}}
    // triple-stashed, or an <a href> attribute, to get a real ampersand
    // there; not something to fix in this spec).
    expect(html).toContain(
      'https://discuva.org/admin/login?subdomain&#x3D;church-alpha',
    );
  });

  it('falls back to the bare, tenant-less login URLs when there is no tenant CLS context', async () => {
    mockCls.get.mockReturnValue(undefined);

    await service.queueEmailWithTemplate('a@b.com', 'Subject', 'welcome', {});

    const html = sentHtml();
    expect(html).toContain(ENV_DEFAULTS.LOGIN_URL);
    expect(html).toContain(ENV_DEFAULTS.ADMIN_LOGIN_URL);
  });

  describe('category suppression', () => {
    it('sends when no category is given, without consulting either gate', async () => {
      await service.queueEmail('a@b.com', 'Subject', '<p>hi</p>');

      expect(mockQueue.add).toHaveBeenCalled();
      expect(mockEmailCategorySettingsService.isEnabled).not.toHaveBeenCalled();
    });

    it('suppresses on the env-level kill switch without checking the tenant setting', async () => {
      mockConfigService.get.mockImplementation((key: string) =>
        key === 'EMAIL_BIRTHDAY_ENABLED' ? false : ENV_DEFAULTS[key],
      );

      const jobId = await service.queueEmail(
        'a@b.com',
        'Subject',
        '<p>hi</p>',
        undefined,
        undefined,
        EmailCategory.BIRTHDAY,
      );

      expect(jobId).toBe('');
      expect(mockQueue.add).not.toHaveBeenCalled();
      expect(mockEmailCategorySettingsService.isEnabled).not.toHaveBeenCalled();
    });

    it("suppresses on the tenant's own per-category setting even when the env flag is on", async () => {
      mockEmailCategorySettingsService.isEnabled.mockResolvedValue(false);

      const jobId = await service.queueEmail(
        'a@b.com',
        'Subject',
        '<p>hi</p>',
        undefined,
        undefined,
        EmailCategory.BIRTHDAY,
      );

      expect(jobId).toBe('');
      expect(mockQueue.add).not.toHaveBeenCalled();
      expect(mockEmailCategorySettingsService.isEnabled).toHaveBeenCalledWith(
        EmailCategory.BIRTHDAY,
      );
    });

    it('sends when both the env flag and the tenant setting are enabled', async () => {
      await service.queueEmail(
        'a@b.com',
        'Subject',
        '<p>hi</p>',
        undefined,
        undefined,
        EmailCategory.BIRTHDAY,
      );

      expect(mockQueue.add).toHaveBeenCalled();
    });
  });

  describe('resolveTenantUrl', () => {
    it("returns the member LOGIN_URL prefixed with the current tenant's subdomain", async () => {
      mockCls.get.mockReturnValue('tenant-1');
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'tenant-1',
        subdomain: 'church-alpha',
      });

      await expect(service.resolveTenantUrl('member')).resolves.toBe(
        'https://church-alpha.discuva.org/login',
      );
    });

    it("returns the admin ADMIN_LOGIN_URL with the current tenant's subdomain as a query param (discuva-admin has no wildcard)", async () => {
      mockCls.get.mockReturnValue('tenant-1');
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'tenant-1',
        subdomain: 'church-alpha',
      });

      await expect(service.resolveTenantUrl('admin')).resolves.toBe(
        'https://discuva.org/admin/login?subdomain=church-alpha',
      );
    });

    it('falls back to the bare env URL when there is no tenant CLS context', async () => {
      mockCls.get.mockReturnValue(undefined);

      await expect(service.resolveTenantUrl('member')).resolves.toBe(
        ENV_DEFAULTS.LOGIN_URL,
      );
    });
  });

  describe('resolveChurchName', () => {
    // Regression coverage: several services used to cache CHURCH_NAME/
    // PRODUCT_NAME once in their own constructor for building an email
    // SUBJECT line, which meant every tenant's subject showed the same
    // static value (or the generic product name) regardless of which
    // church the recipient actually belonged to.
    it("returns the current tenant's own name, not the SaaS product name", async () => {
      mockCls.get.mockReturnValue('tenant-1');
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'tenant-1',
        name: 'RCCG Discovery Centre',
      });

      await expect(service.resolveChurchName()).resolves.toBe(
        'RCCG Discovery Centre',
      );
    });

    it('falls back to the env CHURCH_NAME when there is no tenant CLS context', async () => {
      mockCls.get.mockReturnValue(undefined);

      await expect(service.resolveChurchName()).resolves.toBe(
        ENV_DEFAULTS.CHURCH_NAME,
      );
    });

    it('falls back to the env CHURCH_NAME when the tenant has no name set', async () => {
      mockCls.get.mockReturnValue('tenant-1');
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'tenant-1',
        name: '',
      });

      await expect(service.resolveChurchName()).resolves.toBe(
        ENV_DEFAULTS.CHURCH_NAME,
      );
    });
  });
});
