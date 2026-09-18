import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { PageService } from './page.service';
import { Page } from '../entity/page.entity';
import { TestimonialSubmission } from '../entity/testimonial-submission.entity';
import { Form } from '../../forms/entity/form.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import {
  PageSectionType,
  TestimonialSubmissionStatus,
} from '../enum/page.enum';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import { CacheService } from '../../utility/service/cache.service';
import { CreatePageDto } from '../dto/page.dto';
import { ChurchCalendarService } from '../../church-calendar/service/church-calendar.service';
import { ServiceSessionService } from '../../service-programme/service/service-session.service';
import { PlanFeatureResolverService } from '../../billing/service/plan-feature-resolver.service';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { GalleryFolderSyncService } from './gallery-folder-sync.service';

const mockPageRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'page-1', ...v })),
  find: jest.fn(),
  findOneBy: jest.fn(),
  remove: jest.fn(),
};
const mockFormRepo = {
  findOneBy: jest.fn(),
};
const mockTestimonialSubmissionRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'submission-1', ...v })),
  find: jest.fn().mockResolvedValue([]),
  findOneBy: jest.fn(),
};
const mockCloudinaryService = {
  uploadBuffer: jest.fn(),
  deleteByPublicId: jest.fn(),
};
// No tenant CLS context by default — resolveChurchInfo() falls back to the
// CHURCH_NAME env default, same as TenantCurrencyService's own fallback.
// This is what makes `church` a stable, known value in every existing test
// below that doesn't itself set up a tenant.
const mockTenantRepo = { findOneBy: jest.fn() };
const mockCls = { get: jest.fn().mockReturnValue(undefined) };
const mockCacheService = {
  getOrSet: jest
    .fn()
    .mockImplementation((_key: string, fn: () => Promise<unknown>) => fn()),
};
const ENV_DEFAULTS: Record<string, string | number> = {
  CHURCH_NAME: 'Test Church',
  CACHE_TTL_REFERENCE_SECONDS: 300,
};
const mockConfigService = {
  get: jest.fn((key: string) => ENV_DEFAULTS[key]),
};
const DEFAULT_CHURCH = {
  name: 'Test Church',
  logoUrl: null,
  address: null,
  supportEmail: null,
};
const mockChurchCalendarService = {
  getById: jest.fn(),
};
const mockServiceSessionService = {
  getActiveSessions: jest.fn().mockResolvedValue([]),
};
// features: [] (no plan features) by default — existing tests never
// exercise a CHURCH_CALENDAR section, and isChurchCalendarEntitled/
// assertChurchCalendarEntitled both short-circuit to permissive when
// mockCls.get('tenantId') is undefined (the existing default), so this
// mock's return value only matters for the new tests that explicitly set a
// tenantId.
const mockPlanFeatureResolver = {
  resolve: jest.fn().mockResolvedValue({ features: [], overrides: {} }),
};
const mockGalleryFolderSyncService = {
  extractFolderId: jest.fn(
    (url: string) => /\/folders\/([a-zA-Z0-9_-]+)/.exec(url)?.[1] ?? null,
  ),
  listImages: jest.fn().mockResolvedValue([]),
};

describe('PageService', () => {
  let service: PageService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockTestimonialSubmissionRepo.find.mockResolvedValue([]);
    mockCls.get.mockReturnValue(undefined);
    mockConfigService.get.mockImplementation(
      (key: string) => ENV_DEFAULTS[key],
    );
    mockServiceSessionService.getActiveSessions.mockResolvedValue([]);
    mockPlanFeatureResolver.resolve.mockResolvedValue({
      features: [],
      overrides: {},
    });
    mockGalleryFolderSyncService.listImages.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PageService,
        { provide: getRepositoryToken(Page), useValue: mockPageRepo },
        { provide: getRepositoryToken(Form), useValue: mockFormRepo },
        {
          provide: getRepositoryToken(TestimonialSubmission),
          useValue: mockTestimonialSubmissionRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ClsService, useValue: mockCls },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ChurchCalendarService, useValue: mockChurchCalendarService },
        { provide: ServiceSessionService, useValue: mockServiceSessionService },
        {
          provide: PlanFeatureResolverService,
          useValue: mockPlanFeatureResolver,
        },
        {
          provide: GalleryFolderSyncService,
          useValue: mockGalleryFolderSyncService,
        },
      ],
    }).compile();
    service = module.get(PageService);
  });

  const heroSection = {
    id: 'sec-1',
    type: PageSectionType.HERO,
    content: { title: 'Higher Ground 2026' },
  };
  const faqSection = {
    id: 'sec-2',
    type: PageSectionType.FAQ,
    content: {
      items: [{ question: 'Is parking available?', answer: 'Yes.' }],
    },
  };

  function makeDto(overrides: Partial<CreatePageDto> = {}): CreatePageDto {
    return {
      slug: 'higher-ground-2026',
      title: 'Higher Ground 2026',
      sections: [heroSection, faqSection],
      ...overrides,
    } as CreatePageDto;
  }

  describe('create', () => {
    it('creates a page with valid sections', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(service.create(makeDto())).resolves.toBeDefined();
      expect(mockPageRepo.save).toHaveBeenCalled();
    });

    it('rejects a slug already in use', async () => {
      mockPageRepo.findOneBy.mockResolvedValue({ id: 'other-page' });
      await expect(service.create(makeDto())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a HERO section missing title', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              { id: 'sec-1', type: PageSectionType.HERO, content: {} },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a HERO section with ctaLabel but no ctaUrl', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.HERO,
                content: { title: 'Higher Ground 2026', ctaLabel: 'Register' },
              },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a HERO section with both ctaLabel and ctaUrl', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.HERO,
                content: {
                  title: 'Higher Ground 2026',
                  ctaLabel: 'Register',
                  ctaUrl: 'https://example.com/register',
                },
              },
            ],
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('accepts a HERO section with backgroundImageUrlMobile set', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.HERO,
                content: {
                  title: 'Higher Ground 2026',
                  backgroundImageUrl: 'https://example.com/hero.jpg',
                  backgroundImageUrlMobile:
                    'https://example.com/hero-mobile.jpg',
                },
              },
            ],
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('rejects a STATS section with an empty items array', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.STATS,
                content: { items: [] },
              },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a SPEAKERS item missing a name', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.SPEAKERS,
                content: { items: [{ title: 'Host' }] },
              },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a SCHEDULE day with no entries', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.SCHEDULE,
                content: { days: [{ label: 'Day 1', entries: [] }] },
              },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a valid SCHEDULE section', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.SCHEDULE,
                content: {
                  days: [
                    {
                      label: 'Day 1',
                      entries: [{ time: '10 AM', title: 'Opening' }],
                    },
                  ],
                },
              },
            ],
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('accepts a SCHEDULE day with a date and a per-day venue', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.SCHEDULE,
                content: {
                  days: [
                    {
                      label: 'Day 1',
                      date: 'Friday, August 28th',
                      venue: 'Mercy Seat, Lagos',
                      entries: [{ time: '10 AM', title: 'Opening' }],
                    },
                    {
                      label: 'Day 2',
                      venue: 'Discovery Centre, Obanikoro',
                      entries: [{ time: '2 PM', title: 'Main Service' }],
                    },
                  ],
                },
              },
            ],
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('rejects a REGISTRATION section with no formId', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              { id: 'sec-1', type: PageSectionType.REGISTRATION, content: {} },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects a REGISTRATION section whose formId doesn't exist", async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      mockFormRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.REGISTRATION,
                content: { formId: 'unknown-form' },
              },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a REGISTRATION section whose formId exists', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      mockFormRepo.findOneBy.mockResolvedValue({ id: 'form-1' });
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.REGISTRATION,
                content: { formId: 'form-1' },
              },
            ],
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('rejects a TESTIMONIALS item missing a quote', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.TESTIMONIALS,
                content: { items: [{ name: 'Jane' }] },
              },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a FAQ item missing an answer', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.FAQ,
                content: { items: [{ question: 'Is parking available?' }] },
              },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an ABOUT section missing body', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.ABOUT,
                content: { heading: 'About the conference' },
              },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts an ABOUT section with a valid split layout + image position', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.ABOUT,
                content: {
                  heading: 'About',
                  body: 'Body',
                  imageUrl: 'https://cdn/img.png',
                  layout: 'split',
                  imagePosition: 'left',
                },
              },
            ],
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('rejects an ABOUT section with an invalid layout value', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.ABOUT,
                content: { heading: 'About', body: 'Body', layout: 'sideways' },
              },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a MERCH section missing imageUrl', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              { id: 'sec-1', type: PageSectionType.MERCH, content: {} },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a MERCH section with linkLabel but no linkUrl', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.MERCH,
                content: {
                  imageUrl: 'https://cdn/merch.png',
                  linkLabel: 'Shop now',
                },
              },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a valid MERCH section', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.MERCH,
                content: {
                  imageUrl: 'https://cdn/merch.png',
                  linkLabel: 'Shop now',
                  linkUrl: 'https://shop.example.com',
                },
              },
            ],
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('rejects a COUNTDOWN section missing targetDate', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              { id: 'sec-1', type: PageSectionType.COUNTDOWN, content: {} },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a COUNTDOWN section with an unparseable targetDate', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.COUNTDOWN,
                content: { targetDate: 'not-a-date' },
              },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a valid COUNTDOWN section', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.COUNTDOWN,
                content: {
                  heading: 'Countdown to YFC 2026',
                  targetDate: '2026-11-27T09:00:00.000Z',
                  expiredMessage: "We're live!",
                },
              },
            ],
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('accepts an empty FOOTER section (every field is optional)', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              { id: 'sec-1', type: PageSectionType.FOOTER, content: {} },
            ],
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('accepts a fully-populated FOOTER section', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.FOOTER,
                content: {
                  heading: 'Get In Touch',
                  text: 'Thanks for being part of this.',
                  showCopyright: false,
                  showContactInfo: true,
                  links: [
                    {
                      label: 'Privacy Policy',
                      url: 'https://example.com/privacy',
                    },
                  ],
                  socialLinks: [
                    {
                      platform: 'instagram',
                      url: 'https://instagram.com/example',
                    },
                  ],
                },
              },
            ],
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('rejects a FOOTER link missing a label or url', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.FOOTER,
                content: { links: [{ label: 'Privacy Policy' }] },
              },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a FOOTER social link with an unrecognized platform', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.FOOTER,
                content: {
                  socialLinks: [
                    { platform: 'myspace', url: 'https://myspace.com/example' },
                  ],
                },
              },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-boolean FOOTER showCopyright/showContactInfo', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.FOOTER,
                content: { showCopyright: 'yes' },
              },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a page with two HERO sections', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.HERO,
                content: { title: 'First' },
              },
              {
                id: 'sec-2',
                type: PageSectionType.HERO,
                content: { title: 'Second' },
              },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a page with two FOOTER sections', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.create(
          makeDto({
            sections: [
              { id: 'sec-1', type: PageSectionType.FOOTER, content: {} },
              { id: 'sec-2', type: PageSectionType.FOOTER, content: {} },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a page with two REGISTRATION sections (deliberately unrestricted, e.g. event registration + a separate merch pre-order form)', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      mockFormRepo.findOneBy.mockResolvedValue({ id: 'form-1' });
      await expect(
        service.create(
          makeDto({
            sections: [
              {
                id: 'sec-1',
                type: PageSectionType.REGISTRATION,
                content: { formId: 'form-1' },
              },
              {
                id: 'sec-2',
                type: PageSectionType.REGISTRATION,
                content: { formId: 'form-1' },
              },
            ],
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('defaults theme to minimal and accentColor/backgroundColor/fontFamily/showHeader/headerLogoUrl when omitted', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await service.create(makeDto());
      expect(mockPageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: 'minimal',
          accentColor: null,
          backgroundColor: null,
          fontFamily: null,
          showHeader: false,
          headerLogoUrl: null,
          draftTheme: 'minimal',
          draftAccentColor: null,
          draftBackgroundColor: null,
          draftFontFamily: null,
          draftShowHeader: false,
          draftHeaderLogoUrl: null,
        }),
      );
    });

    it('sets theme/accentColor/backgroundColor/fontFamily/showHeader/headerLogoUrl on both live and draft when provided', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await service.create(
        makeDto({
          theme: 'bold',
          accentColor: '#f97316',
          backgroundColor: '#1a1030',
          fontFamily: 'poppins',
          showHeader: true,
          headerLogoUrl: 'https://cdn/yfc-logo.png',
        }),
      );
      expect(mockPageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: 'bold',
          accentColor: '#f97316',
          backgroundColor: '#1a1030',
          fontFamily: 'poppins',
          showHeader: true,
          headerLogoUrl: 'https://cdn/yfc-logo.png',
          draftTheme: 'bold',
          draftAccentColor: '#f97316',
          draftBackgroundColor: '#1a1030',
          draftFontFamily: 'poppins',
          draftShowHeader: true,
          draftHeaderLogoUrl: 'https://cdn/yfc-logo.png',
        }),
      );
    });
  });

  function makeExistingPage(overrides: Partial<Page> = {}): Partial<Page> {
    return {
      id: 'page-1',
      slug: 'higher-ground-2026',
      title: 'Higher Ground 2026',
      seoDescription: null,
      ogImageUrl: null,
      ogImagePublicId: null,
      sections: [heroSection],
      isPublished: false,
      draftTitle: 'Higher Ground 2026',
      draftSeoDescription: null,
      draftOgImageUrl: null,
      draftOgImagePublicId: null,
      draftSections: [heroSection],
      previewToken: 'preview-token-1',
      ...overrides,
    };
  }

  describe('duplicate', () => {
    it('copies the source draft into a new, unpublished page under the given slug', async () => {
      mockPageRepo.findOneBy
        .mockResolvedValueOnce(
          makeExistingPage({
            isPublished: true,
            draftTitle: 'Higher Ground 2026',
            draftSeoDescription: 'A conference',
            draftTheme: 'bold',
            draftAccentColor: '#f97316',
            draftBackgroundColor: '#1a1030',
            draftFontFamily: 'poppins',
            draftShowHeader: true,
            draftHeaderLogoUrl: 'https://cdn/yfc-logo.png',
            draftSections: [heroSection, faqSection],
          }),
        )
        .mockResolvedValueOnce(null); // assertSlugAvailable: new slug is free
      await service.duplicate('page-1', { slug: 'higher-ground-2026-copy' });
      expect(mockPageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: 'higher-ground-2026-copy',
          title: 'Higher Ground 2026 (Copy)',
          seoDescription: 'A conference',
          isPublished: false,
          theme: 'bold',
          accentColor: '#f97316',
          backgroundColor: '#1a1030',
          fontFamily: 'poppins',
          showHeader: true,
          headerLogoUrl: 'https://cdn/yfc-logo.png',
          sections: [heroSection, faqSection],
          draftTitle: 'Higher Ground 2026 (Copy)',
          draftSections: [heroSection, faqSection],
        }),
      );
    });

    it('uses an explicit title override instead of the "(Copy)" default when given', async () => {
      mockPageRepo.findOneBy
        .mockResolvedValueOnce(makeExistingPage())
        .mockResolvedValueOnce(null);
      await service.duplicate('page-1', {
        slug: 'a-new-slug',
        title: 'A Totally Different Title',
      });
      expect(mockPageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'A Totally Different Title',
          draftTitle: 'A Totally Different Title',
        }),
      );
    });

    it('deep-clones sections rather than sharing references with the source', async () => {
      mockPageRepo.findOneBy
        .mockResolvedValueOnce(
          makeExistingPage({ draftSections: [heroSection] }),
        )
        .mockResolvedValueOnce(null);
      await service.duplicate('page-1', { slug: 'a-new-slug' });
      const savedArg = mockPageRepo.save.mock.calls[0][0];
      expect(savedArg.sections).toEqual([heroSection]);
      expect(savedArg.sections).not.toBe(heroSection);
      expect(savedArg.sections[0]).not.toBe(heroSection);
    });

    it('rejects a slug already in use by another page', async () => {
      mockPageRepo.findOneBy
        .mockResolvedValueOnce(makeExistingPage())
        .mockResolvedValueOnce({ id: 'page-2' });
      await expect(
        service.duplicate('page-1', { slug: 'taken-slug' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('404s when the source page does not exist', async () => {
      mockPageRepo.findOneBy.mockResolvedValueOnce(null);
      await expect(
        service.duplicate('missing', { slug: 'a-new-slug' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('re-validates the source draft sections before duplicating (e.g. a linked form deleted since)', async () => {
      mockPageRepo.findOneBy
        .mockResolvedValueOnce(
          makeExistingPage({
            draftSections: [
              {
                id: 'sec-1',
                type: PageSectionType.REGISTRATION,
                content: { formId: 'deleted-form' },
              },
            ],
          }),
        )
        .mockResolvedValueOnce(null);
      mockFormRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.duplicate('page-1', { slug: 'a-new-slug' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('writes title/seoDescription/sections to their draft* counterparts, never live', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(makeExistingPage());
      await service.update('page-1', {
        title: 'Updated Title',
        seoDescription: 'Updated description',
        sections: [faqSection],
      });
      expect(mockPageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Higher Ground 2026',
          seoDescription: null,
          sections: [heroSection],
          draftTitle: 'Updated Title',
          draftSeoDescription: 'Updated description',
          draftSections: [faqSection],
        }),
      );
    });

    it('leaves draftSections untouched when sections is omitted', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(makeExistingPage());
      await service.update('page-1', { title: 'Updated Title' });
      expect(mockPageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          sections: [heroSection],
          draftSections: [heroSection],
        }),
      );
    });

    it('re-validates sections when provided', async () => {
      mockPageRepo.findOneBy.mockResolvedValueOnce(makeExistingPage());
      await expect(
        service.update('page-1', {
          sections: [{ id: 'sec-1', type: PageSectionType.HERO, content: {} }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows keeping the same slug without a duplicate error', async () => {
      mockPageRepo.findOneBy.mockResolvedValueOnce(makeExistingPage());
      await expect(
        service.update('page-1', { slug: 'higher-ground-2026' }),
      ).resolves.toBeDefined();
      expect(mockPageRepo.findOneBy).toHaveBeenCalledTimes(1);
    });

    it('rejects changing the slug to one already used by another page', async () => {
      mockPageRepo.findOneBy
        .mockResolvedValueOnce(makeExistingPage())
        .mockResolvedValueOnce({ id: 'page-2' });
      await expect(
        service.update('page-1', { slug: 'taken-slug' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('slug and isPublished still write live immediately, unlike content fields', async () => {
      mockPageRepo.findOneBy.mockResolvedValueOnce(makeExistingPage());
      await service.update('page-1', {
        slug: 'higher-ground-2026',
        isPublished: true,
      });
      expect(mockPageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isPublished: true }),
      );
    });

    it('routes theme/accentColor/backgroundColor/fontFamily/showHeader/headerLogoUrl to draft*, not live', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(
        makeExistingPage({
          theme: 'minimal',
          accentColor: null,
          backgroundColor: null,
          fontFamily: null,
          showHeader: false,
          headerLogoUrl: null,
        }),
      );
      await service.update('page-1', {
        theme: 'bold',
        accentColor: '#f97316',
        backgroundColor: '#1a1030',
        fontFamily: 'bebas-neue',
        showHeader: true,
        headerLogoUrl: 'https://cdn/yfc-logo.png',
      });
      expect(mockPageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: 'minimal',
          accentColor: null,
          backgroundColor: null,
          fontFamily: null,
          showHeader: false,
          headerLogoUrl: null,
          draftTheme: 'bold',
          draftAccentColor: '#f97316',
          draftBackgroundColor: '#1a1030',
          draftFontFamily: 'bebas-neue',
          draftShowHeader: true,
          draftHeaderLogoUrl: 'https://cdn/yfc-logo.png',
        }),
      );
    });
  });

  describe('publish', () => {
    it('copies every draft* field onto its live counterpart and sets isPublished', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(
        makeExistingPage({
          title: 'Old Title',
          seoDescription: 'Old description',
          sections: [heroSection],
          isPublished: false,
          draftTitle: 'New Title',
          draftSeoDescription: 'New description',
          draftSections: [heroSection, faqSection],
        }),
      );
      await service.publish('page-1');
      expect(mockPageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Title',
          seoDescription: 'New description',
          sections: [heroSection, faqSection],
          isPublished: true,
        }),
      );
    });

    it('re-validates draftSections before publishing (e.g. a linked form deleted after the draft was saved)', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(
        makeExistingPage({
          draftSections: [
            {
              id: 'sec-1',
              type: PageSectionType.REGISTRATION,
              content: { formId: 'deleted-form' },
            },
          ],
        }),
      );
      mockFormRepo.findOneBy.mockResolvedValue(null);
      await expect(service.publish('page-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deletes the previous live OG image only when publishing actually replaces it', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(
        makeExistingPage({
          ogImagePublicId: 'old-live-public-id',
          draftOgImageUrl: 'https://cdn/new.png',
          draftOgImagePublicId: 'new-public-id',
        }),
      );
      await service.publish('page-1');
      expect(mockCloudinaryService.deleteByPublicId).toHaveBeenCalledWith(
        'old-live-public-id',
        'image',
      );
    });

    it('does not touch Cloudinary when the OG image is unchanged', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(
        makeExistingPage({
          ogImagePublicId: 'same-public-id',
          draftOgImageUrl: 'https://cdn/same.png',
          draftOgImagePublicId: 'same-public-id',
        }),
      );
      await service.publish('page-1');
      expect(mockCloudinaryService.deleteByPublicId).not.toHaveBeenCalled();
    });

    it('copies draftTheme/draftAccentColor/draftBackgroundColor/draftFontFamily/draftShowHeader/draftHeaderLogoUrl onto the live columns', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(
        makeExistingPage({
          theme: 'minimal',
          accentColor: null,
          backgroundColor: null,
          fontFamily: null,
          showHeader: false,
          headerLogoUrl: null,
          draftTheme: 'bold',
          draftAccentColor: '#f97316',
          draftBackgroundColor: '#1a1030',
          draftFontFamily: 'playfair',
          draftShowHeader: true,
          draftHeaderLogoUrl: 'https://cdn/yfc-logo.png',
        }),
      );
      await service.publish('page-1');
      expect(mockPageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: 'bold',
          accentColor: '#f97316',
          backgroundColor: '#1a1030',
          fontFamily: 'playfair',
          showHeader: true,
          headerLogoUrl: 'https://cdn/yfc-logo.png',
        }),
      );
    });
  });

  describe('getForPublic', () => {
    it('returns a mapped dto for a published page', async () => {
      mockPageRepo.findOneBy.mockResolvedValue({
        id: 'page-1',
        slug: 'higher-ground-2026',
        title: 'Higher Ground 2026',
        seoDescription: null,
        ogImageUrl: null,
        sections: [heroSection],
        isPublished: true,
      });
      const result = await service.getForPublic('higher-ground-2026');
      expect(result).toEqual({
        id: 'page-1',
        slug: 'higher-ground-2026',
        title: 'Higher Ground 2026',
        seoDescription: null,
        ogImageUrl: null,
        church: DEFAULT_CHURCH,
        sections: [heroSection],
      });
    });

    it('passes through showHeader and headerLogoUrl from the live columns', async () => {
      mockPageRepo.findOneBy.mockResolvedValue({
        id: 'page-1',
        slug: 'higher-ground-2026',
        sections: [heroSection],
        isPublished: true,
        showHeader: true,
        headerLogoUrl: 'https://cdn/yfc-logo.png',
      });
      const result = await service.getForPublic('higher-ground-2026');
      expect(result.showHeader).toBe(true);
      expect(result.headerLogoUrl).toBe('https://cdn/yfc-logo.png');
    });

    it("includes the current tenant's church info, resolved via CLS + the shared tenant-branding cache entry", async () => {
      mockPageRepo.findOneBy.mockResolvedValue({
        id: 'page-1',
        slug: 'higher-ground-2026',
        sections: [heroSection],
        isPublished: true,
      });
      mockCls.get.mockReturnValue('tenant-1');
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'tenant-1',
        name: 'Grace Chapel',
        logoUrl: 'https://cdn/grace-chapel-logo.png',
        address: '123 Main St',
        supportEmail: 'hello@gracechapel.example',
      });

      const result = await service.getForPublic('higher-ground-2026');

      expect(result.church).toEqual({
        name: 'Grace Chapel',
        logoUrl: 'https://cdn/grace-chapel-logo.png',
        address: '123 Main St',
        supportEmail: 'hello@gracechapel.example',
      });
      expect(mockCacheService.getOrSet).toHaveBeenCalledWith(
        'tenant-branding:tenant-1',
        expect.any(Function),
        300,
      );
    });

    it('404s for an unpublished or unknown slug', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(service.getForPublic('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('filters out sections with hidden: true, keeping everything else', async () => {
      const hiddenSection = { ...faqSection, id: 'sec-hidden', hidden: true };
      mockPageRepo.findOneBy.mockResolvedValue({
        id: 'page-1',
        slug: 'higher-ground-2026',
        title: 'Higher Ground 2026',
        seoDescription: null,
        ogImageUrl: null,
        sections: [heroSection, hiddenSection, faqSection],
        isPublished: true,
      });
      const result = await service.getForPublic('higher-ground-2026');
      expect(result.sections).toEqual([heroSection, faqSection]);
    });
  });

  describe('getForPreview', () => {
    it('returns draft content, not live, when the token matches', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(
        makeExistingPage({
          isPublished: false,
          title: 'Live Title',
          sections: [heroSection],
          draftTitle: 'Draft Title',
          draftSections: [heroSection, faqSection],
          previewToken: 'correct-token',
        }),
      );
      const result = await service.getForPreview(
        'higher-ground-2026',
        'correct-token',
      );
      expect(result).toEqual(
        expect.objectContaining({
          title: 'Draft Title',
          sections: [heroSection, faqSection],
        }),
      );
    });

    it('filters out sections with hidden: true from the draft too', async () => {
      const hiddenSection = { ...faqSection, id: 'sec-hidden', hidden: true };
      mockPageRepo.findOneBy.mockResolvedValue(
        makeExistingPage({
          draftSections: [heroSection, hiddenSection, faqSection],
          previewToken: 'correct-token',
        }),
      );
      const result = await service.getForPreview(
        'higher-ground-2026',
        'correct-token',
      );
      expect(result.sections).toEqual([heroSection, faqSection]);
    });

    it('404s on a wrong token', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(
        makeExistingPage({ previewToken: 'correct-token' }),
      );
      await expect(
        service.getForPreview('higher-ground-2026', 'wrong-token'),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s on a missing token', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(
        makeExistingPage({ previewToken: 'correct-token' }),
      );
      await expect(
        service.getForPreview('higher-ground-2026', ''),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s for an unknown slug regardless of token', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.getForPreview('missing', 'any-token'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listPublished', () => {
    it('returns only published pages, mapped to the minimal shape', async () => {
      mockPageRepo.find.mockResolvedValue([
        {
          slug: 'higher-ground-2026',
          title: 'Higher Ground 2026',
          seoDescription: 'A conference',
          updatedAt: new Date('2026-01-01'),
        },
      ]);
      const result = await service.listPublished();
      expect(mockPageRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isPublished: true } }),
      );
      expect(result).toEqual([
        {
          slug: 'higher-ground-2026',
          title: 'Higher Ground 2026',
          seoDescription: 'A conference',
          updatedAt: new Date('2026-01-01'),
        },
      ]);
    });
  });

  describe('image uploads', () => {
    it('setOgImage writes draftOgImage*, not the live columns', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(
        makeExistingPage({
          ogImagePublicId: 'live-public-id',
          draftOgImagePublicId: 'old-draft-public-id',
        }),
      );
      mockCloudinaryService.uploadBuffer.mockResolvedValue({
        secureUrl: 'https://cdn/new.png',
        publicId: 'new-draft-public-id',
      });
      await service.setOgImage('page-1', {
        buffer: Buffer.from(''),
        mimetype: 'image/png',
      } as Express.Multer.File);
      expect(mockPageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          ogImagePublicId: 'live-public-id',
          draftOgImageUrl: 'https://cdn/new.png',
          draftOgImagePublicId: 'new-draft-public-id',
        }),
      );
    });

    it('deletes the replaced draft image when it differs from the live one', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(
        makeExistingPage({
          ogImagePublicId: 'live-public-id',
          draftOgImagePublicId: 'old-draft-public-id',
        }),
      );
      mockCloudinaryService.uploadBuffer.mockResolvedValue({
        secureUrl: 'https://cdn/new.png',
        publicId: 'new-draft-public-id',
      });
      await service.setOgImage('page-1', {
        buffer: Buffer.from(''),
        mimetype: 'image/png',
      } as Express.Multer.File);
      expect(mockCloudinaryService.deleteByPublicId).toHaveBeenCalledWith(
        'old-draft-public-id',
        'image',
      );
    });

    it('does NOT delete the replaced draft image when it is still the live image', async () => {
      // The draft image was never changed since publish, so it's identical
      // to the live one — uploading a new draft image must not delete the
      // asset the published page still points at.
      mockPageRepo.findOneBy.mockResolvedValue(
        makeExistingPage({
          ogImagePublicId: 'shared-public-id',
          draftOgImagePublicId: 'shared-public-id',
        }),
      );
      mockCloudinaryService.uploadBuffer.mockResolvedValue({
        secureUrl: 'https://cdn/new.png',
        publicId: 'new-draft-public-id',
      });
      await service.setOgImage('page-1', {
        buffer: Buffer.from(''),
        mimetype: 'image/png',
      } as Express.Multer.File);
      expect(mockCloudinaryService.deleteByPublicId).not.toHaveBeenCalled();
    });

    it('removeOgImage clears draftOgImage* only, guarded the same way', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(
        makeExistingPage({
          ogImagePublicId: 'live-public-id',
          draftOgImagePublicId: 'old-draft-public-id',
        }),
      );
      await service.removeOgImage('page-1');
      expect(mockPageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          ogImagePublicId: 'live-public-id',
          draftOgImageUrl: null,
          draftOgImagePublicId: null,
        }),
      );
      expect(mockCloudinaryService.deleteByPublicId).toHaveBeenCalledWith(
        'old-draft-public-id',
        'image',
      );
    });

    it('uploadSectionImage returns a reference without touching the page row', async () => {
      mockPageRepo.findOneBy.mockResolvedValue({ id: 'page-1' });
      mockCloudinaryService.uploadBuffer.mockResolvedValue({
        secureUrl: 'https://cdn/speaker.png',
        publicId: 'speaker-public-id',
      });
      const result = await service.uploadSectionImage('page-1', {
        buffer: Buffer.from(''),
        mimetype: 'image/png',
      } as Express.Multer.File);
      expect(result).toEqual({
        url: 'https://cdn/speaker.png',
        publicId: 'speaker-public-id',
      });
      expect(mockPageRepo.save).not.toHaveBeenCalled();
    });
  });

  const testimonialsSection = {
    id: 'sec-testimonials',
    type: PageSectionType.TESTIMONIALS,
    content: {
      items: [{ quote: 'God is good.', name: 'Jane' }],
      acceptSubmissions: true,
    },
  };

  describe('submitTestimonial', () => {
    it('creates a PENDING submission for a section that accepts them', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(
        makeExistingPage({
          isPublished: true,
          sections: [testimonialsSection],
        }),
      );
      await service.submitTestimonial('higher-ground-2026', {
        sectionId: 'sec-testimonials',
        quote: 'It changed my life.',
        name: 'Sam',
      });
      expect(mockTestimonialSubmissionRepo.save).toHaveBeenCalled();
      expect(mockTestimonialSubmissionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sectionId: 'sec-testimonials',
          quote: 'It changed my life.',
          name: 'Sam',
        }),
      );
    });

    it('rejects when the section does not exist on the page', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(
        makeExistingPage({
          isPublished: true,
          sections: [testimonialsSection],
        }),
      );
      await expect(
        service.submitTestimonial('higher-ground-2026', {
          sectionId: 'no-such-section',
          quote: 'It changed my life.',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockTestimonialSubmissionRepo.save).not.toHaveBeenCalled();
    });

    it('rejects when the section has not opted into acceptSubmissions', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(
        makeExistingPage({
          isPublished: true,
          sections: [
            {
              id: 'sec-testimonials',
              type: PageSectionType.TESTIMONIALS,
              content: { items: [] },
            },
          ],
        }),
      );
      await expect(
        service.submitTestimonial('higher-ground-2026', {
          sectionId: 'sec-testimonials',
          quote: 'It changed my life.',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('404s for an unpublished or unknown slug', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.submitTestimonial('missing', {
          sectionId: 'sec-testimonials',
          quote: 'It changed my life.',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listTestimonialSubmissions / moderateTestimonialSubmission', () => {
    it('lists submissions for a page, optionally filtered by status', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(makeExistingPage());
      mockTestimonialSubmissionRepo.find.mockResolvedValue([
        { id: 'sub-1', status: TestimonialSubmissionStatus.PENDING },
      ]);
      const result = await service.listTestimonialSubmissions(
        'page-1',
        TestimonialSubmissionStatus.PENDING,
      );
      expect(mockTestimonialSubmissionRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            page: { id: 'page-1' },
            status: TestimonialSubmissionStatus.PENDING,
          },
        }),
      );
      expect(result).toEqual([
        { id: 'sub-1', status: TestimonialSubmissionStatus.PENDING },
      ]);
    });

    it('moderates a submission by flipping its status', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(makeExistingPage());
      mockTestimonialSubmissionRepo.findOneBy.mockResolvedValue({
        id: 'sub-1',
        status: TestimonialSubmissionStatus.PENDING,
      });
      await service.moderateTestimonialSubmission('page-1', 'sub-1', {
        status: TestimonialSubmissionStatus.APPROVED,
      });
      expect(mockTestimonialSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sub-1',
          status: TestimonialSubmissionStatus.APPROVED,
        }),
      );
    });

    it('404s when moderating a submission that does not exist', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(makeExistingPage());
      mockTestimonialSubmissionRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.moderateTestimonialSubmission('page-1', 'missing-sub', {
          status: TestimonialSubmissionStatus.APPROVED,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('approved testimonial submissions merged into public output', () => {
    it('getForPublic appends APPROVED submissions to a section that accepts them', async () => {
      mockPageRepo.findOneBy.mockResolvedValue({
        id: 'page-1',
        slug: 'higher-ground-2026',
        title: 'Higher Ground 2026',
        seoDescription: null,
        ogImageUrl: null,
        theme: 'minimal',
        accentColor: null,
        sections: [testimonialsSection],
        isPublished: true,
      });
      mockTestimonialSubmissionRepo.find.mockResolvedValue([
        { sectionId: 'sec-testimonials', quote: 'Amazing.', name: 'Sam' },
      ]);
      const result = await service.getForPublic('higher-ground-2026');
      expect(mockTestimonialSubmissionRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: TestimonialSubmissionStatus.APPROVED,
          }),
        }),
      );
      expect(result.sections[0].content.items).toEqual([
        { quote: 'God is good.', name: 'Jane' },
        { quote: 'Amazing.', name: 'Sam' },
      ]);
    });

    it('does not query submissions when no section accepts them', async () => {
      mockPageRepo.findOneBy.mockResolvedValue({
        id: 'page-1',
        slug: 'higher-ground-2026',
        title: 'Higher Ground 2026',
        seoDescription: null,
        ogImageUrl: null,
        theme: 'minimal',
        accentColor: null,
        sections: [heroSection],
        isPublished: true,
      });
      await service.getForPublic('higher-ground-2026');
      expect(mockTestimonialSubmissionRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('GALLERY section', () => {
    const gallerySection = {
      id: 'sec-gallery',
      type: PageSectionType.GALLERY,
      content: {
        images: [{ url: 'https://cdn/1.jpg', caption: 'Sunday service' }],
      },
    };

    beforeEach(() => {
      // create() checks slug availability before section validation — a
      // stray mockResolvedValue left over from an earlier test elsewhere in
      // this file would otherwise make these throw "slug already in use"
      // instead of exercising the section validation this block is
      // actually testing (jest.clearAllMocks() clears call history, not a
      // previously-set mockResolvedValue implementation).
      mockPageRepo.findOneBy.mockResolvedValue(null);
    });

    it('accepts a valid GALLERY section', async () => {
      const result = await service.create(
        makeDto({ sections: [gallerySection] }),
      );
      expect(result.title).toBeDefined();
    });

    it('rejects a GALLERY section with no images', async () => {
      const invalid = { ...gallerySection, content: { images: [] } };
      await expect(
        service.create(makeDto({ sections: [invalid] })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an image entry missing a url', async () => {
      const invalid = {
        ...gallerySection,
        content: { images: [{ caption: 'No url' }] },
      };
      await expect(
        service.create(makeDto({ sections: [invalid] })),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a syncFolderUrl section with no manually-saved images', async () => {
      const synced = {
        ...gallerySection,
        content: {
          images: [],
          syncFolderUrl: 'https://drive.google.com/drive/folders/abc123',
        },
      };
      const result = await service.create(makeDto({ sections: [synced] }));
      expect(result.title).toBeDefined();
    });

    it('rejects a syncFolderUrl that is not a Drive folder link', async () => {
      const invalid = {
        ...gallerySection,
        content: {
          images: [],
          syncFolderUrl: 'https://example.com/not-a-drive-link',
        },
      };
      await expect(
        service.create(makeDto({ sections: [invalid] })),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('GALLERY folder sync (withSyncedGalleryImages)', () => {
    const syncedGallerySection = {
      id: 'sec-gallery',
      type: PageSectionType.GALLERY,
      content: {
        images: [{ url: 'https://cdn/fallback.jpg', caption: 'Fallback' }],
        syncFolderUrl: 'https://drive.google.com/drive/folders/abc123',
      },
    };

    it('overwrites images with the live folder listing on a public page', async () => {
      mockPageRepo.findOneBy.mockResolvedValue({
        id: 'page-1',
        slug: 'gallery-page',
        isPublished: true,
        sections: [syncedGallerySection],
      });
      mockGalleryFolderSyncService.listImages.mockResolvedValue([
        {
          url: 'https://drive.google.com/uc?export=view&id=f1',
          caption: 'Sunday.jpg',
        },
      ]);

      const result = await service.getForPublic('gallery-page');

      expect(mockGalleryFolderSyncService.listImages).toHaveBeenCalledWith(
        'https://drive.google.com/drive/folders/abc123',
      );
      const gallery = result.sections.find(
        (s) => s.id === 'sec-gallery',
      ) as typeof syncedGallerySection;
      expect(gallery.content.images).toEqual([
        {
          url: 'https://drive.google.com/uc?export=view&id=f1',
          caption: 'Sunday.jpg',
        },
      ]);
    });

    it('falls back to the saved images when the folder sync comes back empty', async () => {
      mockPageRepo.findOneBy.mockResolvedValue({
        id: 'page-1',
        slug: 'gallery-page',
        isPublished: true,
        sections: [syncedGallerySection],
      });
      mockGalleryFolderSyncService.listImages.mockResolvedValue([]);

      const result = await service.getForPublic('gallery-page');

      const gallery = result.sections.find(
        (s) => s.id === 'sec-gallery',
      ) as typeof syncedGallerySection;
      expect(gallery.content.images).toEqual([
        { url: 'https://cdn/fallback.jpg', caption: 'Fallback' },
      ]);
    });

    it('never calls the sync service for a GALLERY section with no syncFolderUrl', async () => {
      mockPageRepo.findOneBy.mockResolvedValue({
        id: 'page-1',
        slug: 'gallery-page',
        isPublished: true,
        sections: [
          {
            id: 'sec-gallery',
            type: PageSectionType.GALLERY,
            content: { images: [{ url: 'https://cdn/1.jpg' }] },
          },
        ],
      });

      await service.getForPublic('gallery-page');

      expect(mockGalleryFolderSyncService.listImages).not.toHaveBeenCalled();
    });
  });

  describe('CHURCH_CALENDAR section', () => {
    const calendarSection = {
      id: 'sec-calendar',
      type: PageSectionType.CHURCH_CALENDAR,
      content: { heading: 'Upcoming', calendarId: 'cal-1' },
    };
    const publishedCalendar = {
      id: 'cal-1',
      title: 'This Month',
      theme: null,
      accentColor: null,
      isPublished: true,
      entries: [{ id: 'e1', date: '2026-04-01', title: 'Easter Service' }],
    };

    beforeEach(() => {
      // Entitled by default in this describe block — the plan-gate cases
      // below explicitly override this. See the GALLERY describe block's
      // own comment for why findOneBy needs resetting here too.
      mockCls.get.mockReturnValue('tenant-1');
      mockPlanFeatureResolver.resolve.mockResolvedValue({
        features: [PlanFeature.CHURCH_CALENDAR],
        overrides: {},
      });
      mockPageRepo.findOneBy.mockResolvedValue(null);
    });

    it('accepts a section referencing an existing, published calendar', async () => {
      mockChurchCalendarService.getById.mockResolvedValue(publishedCalendar);
      const result = await service.create(
        makeDto({ sections: [calendarSection] }),
      );
      expect(result.title).toBeDefined();
    });

    it('rejects a section referencing a calendar that does not exist', async () => {
      mockChurchCalendarService.getById.mockRejectedValue(
        new NotFoundException(),
      );
      await expect(
        service.create(makeDto({ sections: [calendarSection] })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a section referencing an unpublished calendar', async () => {
      mockChurchCalendarService.getById.mockResolvedValue({
        ...publishedCalendar,
        isPublished: false,
      });
      await expect(
        service.create(makeDto({ sections: [calendarSection] })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects the section outright when the tenant is not entitled (plan-gate)', async () => {
      mockChurchCalendarService.getById.mockResolvedValue(publishedCalendar);
      mockPlanFeatureResolver.resolve.mockResolvedValue({
        features: [],
        overrides: {},
      });
      await expect(
        service.create(makeDto({ sections: [calendarSection] })),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'PLAN_UPGRADE_REQUIRED',
          requiredFeature: PlanFeature.CHURCH_CALENDAR,
        }),
      });
    });

    it('getForPublic merges the calendar entries into the section content', async () => {
      mockChurchCalendarService.getById.mockResolvedValue(publishedCalendar);
      mockPageRepo.findOneBy.mockResolvedValue({
        id: 'page-1',
        slug: 'higher-ground-2026',
        sections: [calendarSection],
        isPublished: true,
      });
      const result = await service.getForPublic('higher-ground-2026');
      expect(result.sections[0].content.entries).toEqual(
        publishedCalendar.entries,
      );
      expect(result.sections[0].content.title).toBe('This Month');
    });

    it('getForPublic silently drops the section once the tenant is no longer entitled (downgrade)', async () => {
      mockChurchCalendarService.getById.mockResolvedValue(publishedCalendar);
      mockPlanFeatureResolver.resolve.mockResolvedValue({
        features: [],
        overrides: {},
      });
      mockPageRepo.findOneBy.mockResolvedValue({
        id: 'page-1',
        slug: 'higher-ground-2026',
        sections: [calendarSection, heroSection],
        isPublished: true,
      });
      const result = await service.getForPublic('higher-ground-2026');
      expect(result.sections).toEqual([heroSection]);
    });

    it('getForPublic drops the section if the calendar was unpublished after the section was saved', async () => {
      mockChurchCalendarService.getById.mockResolvedValue({
        ...publishedCalendar,
        isPublished: false,
      });
      mockPageRepo.findOneBy.mockResolvedValue({
        id: 'page-1',
        slug: 'higher-ground-2026',
        sections: [calendarSection, heroSection],
        isPublished: true,
      });
      const result = await service.getForPublic('higher-ground-2026');
      expect(result.sections).toEqual([heroSection]);
    });

    it('getByIdForAdmin surfaces churchCalendarEntitled without hiding the section', async () => {
      mockPlanFeatureResolver.resolve.mockResolvedValue({
        features: [],
        overrides: {},
      });
      mockPageRepo.findOneBy.mockResolvedValue({
        id: 'page-1',
        sections: [calendarSection],
        draftSections: [calendarSection],
      });
      const result = await service.getByIdForAdmin('page-1');
      expect(result.churchCalendarEntitled).toBe(false);
      expect(result.sections).toEqual([calendarSection]);
    });

    it('getAll annotates every page with the same churchCalendarEntitled flag (the builder opens pages from this list, not a per-id fetch)', async () => {
      mockPlanFeatureResolver.resolve.mockResolvedValue({
        features: [],
        overrides: {},
      });
      mockPageRepo.find.mockResolvedValue([
        { id: 'page-1', sections: [calendarSection] },
        { id: 'page-2', sections: [heroSection] },
      ]);
      const result = await service.getAll();
      expect(result).toEqual([
        expect.objectContaining({
          id: 'page-1',
          churchCalendarEntitled: false,
        }),
        expect.objectContaining({
          id: 'page-2',
          churchCalendarEntitled: false,
        }),
      ]);
      expect(mockPlanFeatureResolver.resolve).toHaveBeenCalledTimes(1);
    });
  });

  describe('LIVE_NOW section', () => {
    const liveNowSection = {
      id: 'sec-live',
      type: PageSectionType.LIVE_NOW,
      content: { offlineMessage: 'Nothing live right now.' },
    };

    beforeEach(() => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
    });

    it('accepts a valid LIVE_NOW section', async () => {
      const result = await service.create(
        makeDto({ sections: [liveNowSection] }),
      );
      expect(result.title).toBeDefined();
    });

    it('getForPublic reflects isLive: true and the session info when a service is live', async () => {
      mockServiceSessionService.getActiveSessions.mockResolvedValue([
        {
          sessionCode: 'ABC123',
          serviceSlotName: 'Sunday 9AM',
          startedAt: new Date('2026-03-05T09:00:00Z'),
        },
      ]);
      mockPageRepo.findOneBy.mockResolvedValue({
        id: 'page-1',
        slug: 'higher-ground-2026',
        sections: [liveNowSection],
        isPublished: true,
      });
      const result = await service.getForPublic('higher-ground-2026');
      expect(result.sections[0].content.isLive).toBe(true);
      expect(result.sections[0].content.sessionInfo).toEqual({
        serviceSlotName: 'Sunday 9AM',
        startedAt: new Date('2026-03-05T09:00:00Z'),
      });
    });

    it('getForPublic reflects isLive: false when nothing is live', async () => {
      mockServiceSessionService.getActiveSessions.mockResolvedValue([]);
      mockPageRepo.findOneBy.mockResolvedValue({
        id: 'page-1',
        slug: 'higher-ground-2026',
        sections: [liveNowSection],
        isPublished: true,
      });
      const result = await service.getForPublic('higher-ground-2026');
      expect(result.sections[0].content.isLive).toBe(false);
      expect(result.sections[0].content.sessionInfo).toBeNull();
    });

    it('does not call getActiveSessions when no LIVE_NOW section is present', async () => {
      mockPageRepo.findOneBy.mockResolvedValue({
        id: 'page-1',
        slug: 'higher-ground-2026',
        sections: [heroSection],
        isPublished: true,
      });
      await service.getForPublic('higher-ground-2026');
      expect(
        mockServiceSessionService.getActiveSessions,
      ).not.toHaveBeenCalled();
    });
  });

  describe('regression — an existing page with none of the new section types', () => {
    it('renders byte-identical to before these section types existed', async () => {
      mockPageRepo.findOneBy.mockResolvedValue({
        id: 'page-1',
        slug: 'higher-ground-2026',
        title: 'Higher Ground 2026',
        seoDescription: null,
        ogImageUrl: null,
        sections: [heroSection, faqSection],
        isPublished: true,
      });
      const result = await service.getForPublic('higher-ground-2026');
      expect(result.sections).toEqual([heroSection, faqSection]);
      expect(mockChurchCalendarService.getById).not.toHaveBeenCalled();
      expect(
        mockServiceSessionService.getActiveSessions,
      ).not.toHaveBeenCalled();
    });
  });
});
