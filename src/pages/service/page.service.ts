import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import 'multer';
import { Page } from '../entity/page.entity';
import { Form } from '../../forms/entity/form.entity';
import {
  CreatePageDto,
  PageSectionDto,
  PublicPageDto,
  UpdatePageDto,
} from '../dto/page.dto';
import { PageSectionType } from '../enum/page.enum';
import { CloudinaryService } from '../../utility/service/cloudinary.service';

@Injectable()
export class PageService {
  constructor(
    @InjectRepository(Page)
    private readonly pageRepo: Repository<Page>,
    @InjectRepository(Form)
    private readonly formRepo: Repository<Form>,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async create(dto: CreatePageDto): Promise<Page> {
    await this.assertSlugAvailable(dto.slug);
    await this.assertValidSections(dto.sections);
    const page = this.pageRepo.create({
      slug: dto.slug,
      title: dto.title,
      seoDescription: dto.seoDescription ?? null,
      isPublished: dto.isPublished ?? false,
      sections: dto.sections,
    });
    return this.pageRepo.save(page);
  }

  async getAll(): Promise<Page[]> {
    return this.pageRepo.find({ order: { createdAt: 'DESC' } });
  }

  async getById(id: string): Promise<Page> {
    const page = await this.pageRepo.findOneBy({ id });
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  // Only a published page is ever reachable here — an unpublished draft
  // 404s the same as a slug that doesn't exist at all, so a visitor can
  // never distinguish "never existed" from "not live yet". Unlike Forms'
  // PublicFormDto, nothing is stripped from `sections` (see PublicPageDto's
  // own comment).
  async getForPublic(slug: string): Promise<PublicPageDto> {
    const page = await this.pageRepo.findOneBy({ slug, isPublished: true });
    if (!page) throw new NotFoundException('Page not found');
    return {
      id: page.id,
      slug: page.slug,
      title: page.title,
      seoDescription: page.seoDescription,
      ogImageUrl: page.ogImageUrl,
      sections: page.sections,
    };
  }

  async update(id: string, dto: UpdatePageDto): Promise<Page> {
    const page = await this.getById(id);

    if (dto.slug !== undefined && dto.slug !== page.slug) {
      await this.assertSlugAvailable(dto.slug, id);
      page.slug = dto.slug;
    }
    if (dto.title !== undefined) page.title = dto.title;
    if (dto.seoDescription !== undefined) {
      page.seoDescription = dto.seoDescription;
    }
    if (dto.isPublished !== undefined) page.isPublished = dto.isPublished;
    if (dto.sections !== undefined) {
      await this.assertValidSections(dto.sections);
      page.sections = dto.sections;
    }

    return this.pageRepo.save(page);
  }

  async delete(id: string): Promise<void> {
    const page = await this.getById(id);
    await this.pageRepo.remove(page);
  }

  private async assertSlugAvailable(
    slug: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.pageRepo.findOneBy({ slug });
    if (existing && existing.id !== excludeId) {
      throw new BadRequestException(`The slug "${slug}" is already in use`);
    }
  }

  // Per-type structural validation the DTO's envelope-only decorators can't
  // express (`content`'s shape depends on `type`) — same reasoning
  // FormService.assertValidOptionMetadata/assertValidPostSubmitOutcomes
  // validate jsonb content in the service rather than via decorators.
  // REGISTRATION's formId is the one genuinely cross-referential check
  // (must reference a Form that actually exists in this tenant).
  private async assertValidSections(sections: PageSectionDto[]): Promise<void> {
    for (const section of sections) {
      const label = `Section "${section.type}"`;
      switch (section.type) {
        case PageSectionType.HERO:
          this.requireString(section.content, 'title', label);
          this.optionalString(section.content, 'subtitle', label);
          this.optionalString(section.content, 'dateRangeText', label);
          this.optionalString(section.content, 'backgroundImageUrl', label);
          this.assertPaired(section.content, 'ctaLabel', 'ctaUrl', label);
          break;
        case PageSectionType.ABOUT:
          this.requireString(section.content, 'heading', label);
          this.requireString(section.content, 'body', label);
          this.optionalString(section.content, 'imageUrl', label);
          break;
        case PageSectionType.STATS:
          this.requireArray(section.content, 'items', label, (item, i) => {
            const itemLabel = `${label}, item #${i + 1}`;
            this.requireString(item, 'label', itemLabel);
            this.requireString(item, 'value', itemLabel);
          });
          break;
        case PageSectionType.SPEAKERS:
          this.optionalString(section.content, 'heading', label);
          this.requireArray(section.content, 'items', label, (item, i) => {
            const itemLabel = `${label}, speaker #${i + 1}`;
            this.requireString(item, 'name', itemLabel);
            this.optionalString(item, 'title', itemLabel);
            this.optionalString(item, 'photoUrl', itemLabel);
          });
          break;
        case PageSectionType.SCHEDULE:
          this.optionalString(section.content, 'heading', label);
          this.requireArray(section.content, 'days', label, (day, i) => {
            const dayLabel = `${label}, day #${i + 1}`;
            this.requireString(day, 'label', dayLabel);
            this.requireArray(day, 'entries', dayLabel, (entry, j) => {
              const entryLabel = `${dayLabel}, entry #${j + 1}`;
              this.optionalString(entry, 'time', entryLabel);
              this.requireString(entry, 'title', entryLabel);
            });
          });
          break;
        case PageSectionType.REGISTRATION: {
          this.optionalString(section.content, 'heading', label);
          this.optionalString(section.content, 'body', label);
          this.optionalString(section.content, 'ctaLabel', label);
          const formId = this.requireString(section.content, 'formId', label);
          const form = await this.formRepo.findOneBy({ id: formId });
          if (!form) {
            throw new BadRequestException(
              `${label}: formId references a form that doesn't exist`,
            );
          }
          break;
        }
        case PageSectionType.TESTIMONIALS:
          this.optionalString(section.content, 'heading', label);
          this.requireArray(section.content, 'items', label, (item, i) => {
            const itemLabel = `${label}, testimonial #${i + 1}`;
            this.requireString(item, 'quote', itemLabel);
            this.optionalString(item, 'name', itemLabel);
            this.optionalString(item, 'photoUrl', itemLabel);
          });
          break;
        case PageSectionType.FAQ:
          this.optionalString(section.content, 'heading', label);
          this.requireArray(section.content, 'items', label, (item, i) => {
            const itemLabel = `${label}, question #${i + 1}`;
            this.requireString(item, 'question', itemLabel);
            this.requireString(item, 'answer', itemLabel);
          });
          break;
      }
    }
  }

  private requireString(
    content: Record<string, unknown>,
    key: string,
    label: string,
  ): string {
    const value = content[key];
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${label}: "${key}" is required`);
    }
    return value;
  }

  private optionalString(
    content: Record<string, unknown>,
    key: string,
    label: string,
  ): void {
    const value = content[key];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw new BadRequestException(`${label}: "${key}" must be a string`);
    }
  }

  // Both fields together or neither — same "nothing to click, nowhere to
  // send them" reasoning as FormService.assertValidGeneralAction.
  private assertPaired(
    content: Record<string, unknown>,
    labelKey: string,
    urlKey: string,
    label: string,
  ): void {
    const ctaLabel = content[labelKey];
    const ctaUrl = content[urlKey];
    if (!ctaLabel && !ctaUrl) return;
    if (!ctaLabel || !ctaUrl) {
      throw new BadRequestException(
        `${label}: "${labelKey}" and "${urlKey}" must both be set, or both left empty`,
      );
    }
  }

  private requireArray(
    content: Record<string, unknown>,
    key: string,
    label: string,
    checkItem: (item: Record<string, unknown>, index: number) => void,
  ): void {
    const value = content[key];
    if (!Array.isArray(value) || value.length === 0) {
      throw new BadRequestException(
        `${label}: "${key}" needs at least one entry`,
      );
    }
    value.forEach((item, index) => {
      if (!item || typeof item !== 'object') {
        throw new BadRequestException(
          `${label}: "${key}" entry #${index + 1} is invalid`,
        );
      }
      checkItem(item as Record<string, unknown>, index);
    });
  }

  // Mirrors FormService.setCoverImage's "delete the previous asset only
  // after the new one is safely saved" ordering.
  async setOgImage(id: string, file: Express.Multer.File): Promise<Page> {
    const page = await this.getById(id);
    const previousPublicId = page.ogImagePublicId;
    const uploaded = await this.cloudinaryService.uploadBuffer(
      file.buffer,
      'page-images',
      undefined,
      file.mimetype,
    );
    page.ogImageUrl = uploaded.secureUrl;
    page.ogImagePublicId = uploaded.publicId;
    const saved = await this.pageRepo.save(page);
    if (previousPublicId) {
      this.cloudinaryService.deleteByPublicId(previousPublicId, 'image');
    }
    return saved;
  }

  async removeOgImage(id: string): Promise<Page> {
    const page = await this.getById(id);
    const previousPublicId = page.ogImagePublicId;
    page.ogImageUrl = null;
    page.ogImagePublicId = null;
    const saved = await this.pageRepo.save(page);
    if (previousPublicId) {
      this.cloudinaryService.deleteByPublicId(previousPublicId, 'image');
    }
    return saved;
  }

  // Generic upload used by every image slot in every section type (hero
  // background, each speaker photo, gallery images) — returns a reference
  // only, doesn't touch the Page row itself; the caller embeds the url into
  // whichever section's content it belongs to on the next save. Admin-only
  // (AdminGuard), unlike Forms' visitor-facing attachment uploads, so the
  // volume of an abandoned upload (started, page edit never saved) is low
  // enough that no orphan-cleanup sweep is built for v1 — an accepted
  // tradeoff, not an oversight.
  async uploadSectionImage(
    id: string,
    file: Express.Multer.File,
  ): Promise<{ url: string; publicId: string }> {
    await this.getById(id);
    const uploaded = await this.cloudinaryService.uploadBuffer(
      file.buffer,
      'page-images',
      undefined,
      file.mimetype,
    );
    return { url: uploaded.secureUrl, publicId: uploaded.publicId };
  }
}
