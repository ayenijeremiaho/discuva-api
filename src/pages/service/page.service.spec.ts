import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PageService } from './page.service';
import { Page } from '../entity/page.entity';
import { Form } from '../../forms/entity/form.entity';
import { PageSectionType } from '../enum/page.enum';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import { CreatePageDto } from '../dto/page.dto';

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
const mockCloudinaryService = {
  uploadBuffer: jest.fn(),
  deleteByPublicId: jest.fn(),
};

describe('PageService', () => {
  let service: PageService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PageService,
        { provide: getRepositoryToken(Page), useValue: mockPageRepo },
        { provide: getRepositoryToken(Form), useValue: mockFormRepo },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
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
  });

  describe('update', () => {
    it('leaves sections untouched when omitted', async () => {
      mockPageRepo.findOneBy.mockResolvedValue({
        id: 'page-1',
        slug: 'higher-ground-2026',
        title: 'Higher Ground 2026',
        sections: [heroSection],
        isPublished: false,
      });
      await service.update('page-1', { title: 'Updated Title' });
      expect(mockPageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ sections: [heroSection] }),
      );
    });

    it('re-validates sections when provided', async () => {
      mockPageRepo.findOneBy.mockResolvedValueOnce({
        id: 'page-1',
        slug: 'higher-ground-2026',
        title: 'Higher Ground 2026',
        sections: [heroSection],
        isPublished: false,
      });
      await expect(
        service.update('page-1', {
          sections: [{ id: 'sec-1', type: PageSectionType.HERO, content: {} }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows keeping the same slug without a duplicate error', async () => {
      mockPageRepo.findOneBy.mockResolvedValueOnce({
        id: 'page-1',
        slug: 'higher-ground-2026',
        title: 'Higher Ground 2026',
        sections: [heroSection],
        isPublished: false,
      });
      await expect(
        service.update('page-1', { slug: 'higher-ground-2026' }),
      ).resolves.toBeDefined();
      expect(mockPageRepo.findOneBy).toHaveBeenCalledTimes(1);
    });

    it('rejects changing the slug to one already used by another page', async () => {
      mockPageRepo.findOneBy
        .mockResolvedValueOnce({
          id: 'page-1',
          slug: 'higher-ground-2026',
          title: 'Higher Ground 2026',
          sections: [heroSection],
          isPublished: false,
        })
        .mockResolvedValueOnce({ id: 'page-2' });
      await expect(
        service.update('page-1', { slug: 'taken-slug' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('publishes a page via isPublished', async () => {
      mockPageRepo.findOneBy.mockResolvedValueOnce({
        id: 'page-1',
        slug: 'higher-ground-2026',
        title: 'Higher Ground 2026',
        sections: [heroSection],
        isPublished: false,
      });
      await service.update('page-1', { isPublished: true });
      expect(mockPageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isPublished: true }),
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
        sections: [heroSection],
      });
    });

    it('404s for an unpublished or unknown slug', async () => {
      mockPageRepo.findOneBy.mockResolvedValue(null);
      await expect(service.getForPublic('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('image uploads', () => {
    it('setOgImage deletes the previous asset only after the new one saves', async () => {
      mockPageRepo.findOneBy.mockResolvedValue({
        id: 'page-1',
        ogImagePublicId: 'old-public-id',
      });
      mockCloudinaryService.uploadBuffer.mockResolvedValue({
        secureUrl: 'https://cdn/new.png',
        publicId: 'new-public-id',
      });
      await service.setOgImage('page-1', {
        buffer: Buffer.from(''),
        mimetype: 'image/png',
      } as Express.Multer.File);
      expect(mockPageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          ogImageUrl: 'https://cdn/new.png',
          ogImagePublicId: 'new-public-id',
        }),
      );
      expect(mockCloudinaryService.deleteByPublicId).toHaveBeenCalledWith(
        'old-public-id',
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
});
