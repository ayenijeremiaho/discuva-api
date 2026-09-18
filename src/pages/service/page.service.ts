import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import 'multer';
import { HeaderLink, Page, PageSection } from '../entity/page.entity';
import { TestimonialSubmission } from '../entity/testimonial-submission.entity';
import { Form } from '../../forms/entity/form.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import {
  CreatePageDto,
  DuplicatePageDto,
  FOOTER_SOCIAL_PLATFORMS,
  ModerateTestimonialSubmissionDto,
  PageSectionDto,
  PageTheme,
  PublicPageDto,
  SubmitTestimonialDto,
  UpdatePageDto,
} from '../dto/page.dto';
import {
  PageSectionType,
  TestimonialSubmissionStatus,
} from '../enum/page.enum';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import { CacheService } from '../../utility/service/cache.service';
import { ChurchCalendarService } from '../../church-calendar/service/church-calendar.service';
import { ServiceSessionService } from '../../service-programme/service/service-session.service';
import { PlanFeatureResolverService } from '../../billing/service/plan-feature-resolver.service';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { GalleryFolderSyncService } from './gallery-folder-sync.service';

@Injectable()
export class PageService {
  private readonly cacheTtl: number;

  constructor(
    @InjectRepository(Page)
    private readonly pageRepo: Repository<Page>,
    @InjectRepository(Form)
    private readonly formRepo: Repository<Form>,
    @InjectRepository(TestimonialSubmission)
    private readonly testimonialSubmissionRepo: Repository<TestimonialSubmission>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly configService: ConfigService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly cacheService: CacheService,
    private readonly churchCalendarService: ChurchCalendarService,
    private readonly serviceSessionService: ServiceSessionService,
    private readonly planFeatureResolver: PlanFeatureResolverService,
    private readonly galleryFolderSyncService: GalleryFolderSyncService,
  ) {
    this.cacheTtl = this.configService.get<number>(
      'CACHE_TTL_REFERENCE_SECONDS',
      300,
    );
  }

  async create(dto: CreatePageDto): Promise<Page> {
    await this.assertSlugAvailable(dto.slug);
    await this.assertValidSections(dto.sections);
    // Live and draft start identical — nothing is live yet for a brand-new
    // page, so there's no content to protect from an in-progress edit the
    // way update() protects an already-published page (see its own
    // comment). isPublished still independently gates reachability.
    const page = this.pageRepo.create({
      slug: dto.slug,
      title: dto.title,
      seoDescription: dto.seoDescription ?? null,
      isPublished: dto.isPublished ?? false,
      theme: dto.theme ?? 'minimal',
      accentColor: dto.accentColor ?? null,
      backgroundColor: dto.backgroundColor ?? null,
      fontFamily: dto.fontFamily ?? null,
      showHeader: dto.showHeader ?? false,
      headerLogoUrl: dto.headerLogoUrl ?? null,
      headerLinks: dto.headerLinks ?? [],
      sections: dto.sections,
      draftTitle: dto.title,
      draftSeoDescription: dto.seoDescription ?? null,
      draftTheme: dto.theme ?? 'minimal',
      draftAccentColor: dto.accentColor ?? null,
      draftBackgroundColor: dto.backgroundColor ?? null,
      draftFontFamily: dto.fontFamily ?? null,
      draftShowHeader: dto.showHeader ?? false,
      draftHeaderLogoUrl: dto.headerLogoUrl ?? null,
      draftHeaderLinks: dto.headerLinks ?? [],
      draftSections: dto.sections,
    });
    return this.pageRepo.save(page);
  }

  // Starts a brand-new page from an existing one's current DRAFT (not
  // live) — the most up-to-date working version, same reasoning `openEdit`
  // on the discuva-admin side always continues from draft*, not live.
  // Always unpublished regardless of the source's own isPublished state: a
  // duplicate under a fresh, unreviewed slug must never go live silently
  // just because the page it was copied from happened to be live. Neither
  // OG image is carried over — sharing one Cloudinary asset's public_id
  // across two Page rows would make either page's own image-replace/remove
  // flow able to delete an asset the other still points at; simplest safe
  // answer is the duplicate starts with no OG image, same "no orphan-
  // cleanup, accepted simplicity" tradeoff already made elsewhere in this
  // service. previewToken is not copied either — the DB default on the new
  // row generates a fresh one, since every page needs its own private
  // preview link.
  async duplicate(id: string, dto: DuplicatePageDto): Promise<Page> {
    const source = await this.getById(id);
    await this.assertSlugAvailable(dto.slug);

    // Deep-cloned, not shared by reference — from this point these are two
    // genuinely independent pages; neither's later edits may bleed into
    // the other through a shared nested content/style object.
    const sections = JSON.parse(
      JSON.stringify(source.draftSections),
    ) as PageSection[];
    await this.assertValidSections(sections);
    const headerLinks = JSON.parse(
      JSON.stringify(source.draftHeaderLinks ?? []),
    ) as HeaderLink[];

    const title = dto.title ?? `${source.draftTitle} (Copy)`;
    const page = this.pageRepo.create({
      slug: dto.slug,
      title,
      seoDescription: source.draftSeoDescription,
      isPublished: false,
      theme: source.draftTheme,
      accentColor: source.draftAccentColor,
      backgroundColor: source.draftBackgroundColor,
      fontFamily: source.draftFontFamily,
      showHeader: source.draftShowHeader,
      headerLogoUrl: source.draftHeaderLogoUrl,
      headerLinks,
      sections,
      draftTitle: title,
      draftSeoDescription: source.draftSeoDescription,
      draftTheme: source.draftTheme,
      draftAccentColor: source.draftAccentColor,
      draftBackgroundColor: source.draftBackgroundColor,
      draftFontFamily: source.draftFontFamily,
      draftShowHeader: source.draftShowHeader,
      draftHeaderLogoUrl: source.draftHeaderLogoUrl,
      draftHeaderLinks: headerLinks,
      draftSections: sections,
    });
    return this.pageRepo.save(page);
  }

  // discuva-admin's builder opens a page for editing straight from this
  // list's own in-memory array (openEdit(page: PageRecord)) — it never
  // makes a separate per-id fetch — so `churchCalendarEntitled` is
  // attached here, not only on getByIdForAdmin below, or the editor would
  // never actually see it. One resolve() call, reused for every row: the
  // entitlement is tenant-wide, not per-page.
  async getAll(): Promise<(Page & { churchCalendarEntitled: boolean })[]> {
    const [pages, churchCalendarEntitled] = await Promise.all([
      this.pageRepo.find({ order: { createdAt: 'DESC' } }),
      this.isChurchCalendarEntitled(),
    ]);
    return pages.map((page) => ({ ...page, churchCalendarEntitled }));
  }

  async getById(id: string): Promise<Page> {
    const page = await this.pageRepo.findOneBy({ id });
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  // Backs the admin builder's own single-page GET (unlike
  // getForPublic/getForPreview, this never hides a downgraded
  // CHURCH_CALENDAR section — an admin editing their own page shouldn't
  // have their configuration silently vanish from view). Instead surfaces
  // `churchCalendarEntitled` alongside the untouched page so the editor
  // can show a "requires upgrade — not currently visible to visitors"
  // badge on that section's card, same entitlement check
  // getForPublic/getForPreview use to decide whether to drop the section
  // for a real visitor. See getAll's own comment for why that list
  // endpoint carries the identical flag too.
  async getByIdForAdmin(
    id: string,
  ): Promise<Page & { churchCalendarEntitled: boolean }> {
    const page = await this.getById(id);
    return {
      ...page,
      churchCalendarEntitled: await this.isChurchCalendarEntitled(),
    };
  }

  // Only a published page is ever reachable here — an unpublished draft
  // 404s the same as a slug that doesn't exist at all, so a visitor can
  // never distinguish "never existed" from "not live yet". Unlike Forms'
  // PublicFormDto, nothing is stripped from an individual section's
  // `content` (see PublicPageDto's own comment) — the one exception is a
  // whole section with `hidden: true`, filtered out below, same as it never
  // existed in the array at all.
  async getForPublic(slug: string): Promise<PublicPageDto> {
    const page = await this.pageRepo.findOneBy({ slug, isPublished: true });
    if (!page) throw new NotFoundException('Page not found');
    return {
      id: page.id,
      slug: page.slug,
      title: page.title,
      seoDescription: page.seoDescription,
      ogImageUrl: page.ogImageUrl,
      theme: page.theme as PageTheme,
      accentColor: page.accentColor,
      backgroundColor: page.backgroundColor,
      fontFamily: page.fontFamily,
      showHeader: page.showHeader,
      headerLogoUrl: page.headerLogoUrl,
      headerLinks: page.headerLinks,
      church: await this.resolveChurchInfo(),
      sections: this.withoutHiddenSections(
        await this.withSyncedGalleryImages(
          await this.withLiveStatus(
            await this.withChurchCalendarEntries(
              await this.withApprovedTestimonials(page, page.sections),
            ),
          ),
        ),
      ),
    };
  }

  // The shareable "Preview" link's target — same PublicPageDto shape as
  // getForPublic, sourced from draft* instead, so an admin sees exactly
  // what a visitor will see once they publish — hidden sections are
  // filtered out here too, for exactly that reason: a "preview" that showed
  // sections publishing would actually hide wouldn't be previewing the real
  // outcome. No isPublished check: a page that's never been published at
  // all is still previewable. The token is the only gate — anyone without
  // it gets the same 404 a nonexistent slug would, same "don't reveal which
  // reason" posture getForPublic already takes for unpublished vs.
  // nonexistent.
  async getForPreview(slug: string, token: string): Promise<PublicPageDto> {
    const page = await this.pageRepo.findOneBy({ slug });
    if (!page || !token || page.previewToken !== token) {
      throw new NotFoundException('Page not found');
    }
    return {
      id: page.id,
      slug: page.slug,
      title: page.draftTitle,
      seoDescription: page.draftSeoDescription,
      ogImageUrl: page.draftOgImageUrl,
      theme: page.draftTheme as PageTheme,
      accentColor: page.draftAccentColor,
      backgroundColor: page.draftBackgroundColor,
      fontFamily: page.draftFontFamily,
      showHeader: page.draftShowHeader,
      headerLogoUrl: page.draftHeaderLogoUrl,
      headerLinks: page.draftHeaderLinks,
      church: await this.resolveChurchInfo(),
      sections: this.withoutHiddenSections(
        await this.withSyncedGalleryImages(
          await this.withLiveStatus(
            await this.withChurchCalendarEntries(
              await this.withApprovedTestimonials(page, page.draftSections),
            ),
          ),
        ),
      ),
    };
  }

  // Backs PublicPageDto.church: the automatic minimal footer shown when a
  // page has no FOOTER section at all (name + copyright line), a FOOTER
  // section's own optional "show contact info" toggle (address + support
  // email), and — new — the optional header's logo/name (see
  // Page.showHeader). Shares the same `tenant-branding:${tenantId}` cache
  // entry EmailQueueService/PdfService/TenantCurrencyService already
  // populate (see TenantCurrencyService's own comment) — this is very
  // likely a cache hit, not a fresh query, for any tenant with an active
  // Page. No tenant CLS context (shouldn't happen for a real request here,
  // but mirrors TenantCurrencyService's own defensive fallback) falls back
  // to the CHURCH_NAME env default with no logo/address/email — same
  // fallback TenantInfoController's own toProfile() uses for logoUrl.
  private async resolveChurchInfo(): Promise<PublicPageDto['church']> {
    const tenantId = this.cls.get('tenantId');
    const tenant = tenantId
      ? await this.cacheService.getOrSet(
          `tenant-branding:${tenantId}`,
          () => this.tenantRepo.findOneBy({ id: tenantId }),
          this.cacheTtl,
        )
      : null;
    return {
      name: tenant?.name ?? this.configService.get<string>('CHURCH_NAME'),
      logoUrl:
        tenant?.logoUrl ?? this.configService.get<string>('LOGO_URL') ?? null,
      address: tenant?.address ?? null,
      supportEmail: tenant?.supportEmail ?? null,
    };
  }

  // See getForPublic/getForPreview's own comments — a hidden section stays
  // saved (content, style, position) but never reaches either the public
  // route or its own preview, same as if it weren't in the array at all.
  private withoutHiddenSections(sections: PageSection[]): PageSection[] {
    return sections.filter((s) => !s.hidden);
  }

  // A TESTIMONIALS section with content.acceptSubmissions === true also
  // shows visitor-submitted testimonies once an admin approves them —
  // merged in here, server-side, so discuva-member's rendering never needs
  // a second fetch: it just sees a possibly-longer `items` array. Submitted
  // items carry no photoUrl (public submission never accepts an image
  // upload — see SubmitTestimonialDto's own comment).
  private async withApprovedTestimonials(
    page: Page,
    sections: PageSection[],
  ): Promise<PageSection[]> {
    const testimonialSectionIds = sections
      .filter(
        (s) =>
          s.type === PageSectionType.TESTIMONIALS &&
          s.content?.acceptSubmissions === true,
      )
      .map((s) => s.id);
    if (testimonialSectionIds.length === 0) return sections;

    const approved = await this.testimonialSubmissionRepo.find({
      where: {
        page: { id: page.id },
        sectionId: In(testimonialSectionIds),
        status: TestimonialSubmissionStatus.APPROVED,
      },
      order: { createdAt: 'ASC' },
    });

    return sections.map((s) => {
      if (!testimonialSectionIds.includes(s.id)) return s;
      const existingItems = Array.isArray(s.content.items)
        ? s.content.items
        : [];
      const submittedItems = approved
        .filter((sub) => sub.sectionId === s.id)
        .map((sub) => ({ quote: sub.quote, name: sub.name ?? undefined }));
      return {
        ...s,
        content: { ...s.content, items: [...existingItems, ...submittedItems] },
      };
    });
  }

  // Merges the referenced ChurchCalendar's live entries into each
  // CHURCH_CALENDAR section's content, server-side — the member/public
  // renderer just maps over content.entries, no client fetch, same
  // contract withApprovedTestimonials already establishes for TESTIMONIALS.
  // Re-checks BOTH the calendar's own isPublished (an admin un-publishing
  // the calendar later hides it from the page without touching the
  // section) AND the tenant's current plan entitlement (a section saved
  // while entitled doesn't keep working forever after a downgrade) — a
  // section failing either check is dropped from the output array
  // entirely, never returned broken/half-filled, so a visitor never sees a
  // permission error. The section's own config is never touched — this
  // only affects what's returned from this one read.
  private async withChurchCalendarEntries(
    sections: PageSection[],
  ): Promise<PageSection[]> {
    const calendarSectionIds = sections
      .filter((s) => s.type === PageSectionType.CHURCH_CALENDAR)
      .map((s) => s.id);
    if (calendarSectionIds.length === 0) return sections;

    if (!(await this.isChurchCalendarEntitled())) {
      return sections.filter((s) => !calendarSectionIds.includes(s.id));
    }

    const enriched = await Promise.all(
      sections.map(async (s) => {
        if (!calendarSectionIds.includes(s.id)) return s;
        const calendarId = s.content?.calendarId;
        const calendar =
          typeof calendarId === 'string'
            ? await this.churchCalendarService
                .getById(calendarId)
                .catch(() => null)
            : null;
        if (!calendar?.isPublished) return null;
        return {
          ...s,
          content: {
            ...s.content,
            title: calendar.title,
            theme: calendar.theme,
            accentColor: calendar.accentColor,
            entries: calendar.entries,
          },
        };
      }),
    );
    return enriched.filter((s): s is PageSection => s !== null);
  }

  // Merges tenant-wide "is a service live right now" status into every
  // LIVE_NOW section — always reflects the current moment, no
  // cross-reference to validate (unlike CHURCH_CALENDAR, this section type
  // has nothing an admin could point at a deleted/unpublished record, so
  // there's no equivalent drop-the-section case here).
  private async withLiveStatus(
    sections: PageSection[],
  ): Promise<PageSection[]> {
    const hasLiveNowSection = sections.some(
      (s) => s.type === PageSectionType.LIVE_NOW,
    );
    if (!hasLiveNowSection) return sections;

    const activeSessions = await this.serviceSessionService.getActiveSessions();
    const isLive = activeSessions.length > 0;
    return sections.map((s) => {
      if (s.type !== PageSectionType.LIVE_NOW) return s;
      return {
        ...s,
        content: {
          ...s.content,
          isLive,
          sessionInfo: isLive
            ? {
                serviceSlotName: activeSessions[0].serviceSlotName,
                startedAt: activeSessions[0].startedAt,
              }
            : null,
        },
      };
    });
  }

  // "A specified path, just updating pictures... always updated" — merges
  // a live Drive folder listing into any GALLERY section with
  // syncFolderUrl set, overwriting `images` in the response only (never
  // written back to the saved section). A sync failure (unset
  // GOOGLE_DRIVE_API_KEY, folder not public, quota, network) comes back
  // as [] from GalleryFolderSyncService and falls back to whatever
  // `images` the section already had saved — a visitor never sees a
  // broken or empty gallery just because the folder sync had a bad day.
  private async withSyncedGalleryImages(
    sections: PageSection[],
  ): Promise<PageSection[]> {
    const syncedSectionIds = sections
      .filter(
        (s) => s.type === PageSectionType.GALLERY && s.content?.syncFolderUrl,
      )
      .map((s) => s.id);
    if (syncedSectionIds.length === 0) return sections;

    return Promise.all(
      sections.map(async (s) => {
        if (!syncedSectionIds.includes(s.id)) return s;
        const images = await this.galleryFolderSyncService.listImages(
          s.content.syncFolderUrl as string,
        );
        return images.length ? { ...s, content: { ...s.content, images } } : s;
      }),
    );
  }

  // Feeds discuva-member's sitemap/robots/llms.txt routes — every published
  // page for the tenant resolved by TenantMiddleware off the incoming
  // request, same as getForPublic. Deliberately minimal: only what a
  // crawler/LLM index actually needs, never draft content or the token.
  async listPublished(): Promise<
    {
      slug: string;
      title: string;
      seoDescription: string | null;
      updatedAt: Date;
    }[]
  > {
    const pages = await this.pageRepo.find({
      where: { isPublished: true },
      order: { updatedAt: 'DESC' },
    });
    return pages.map((p) => ({
      slug: p.slug,
      title: p.title,
      seoDescription: p.seoDescription,
      updatedAt: p.updatedAt,
    }));
  }

  // title/seoDescription/sections write to their draft* counterparts only —
  // an already-published page can be edited freely without a single Save
  // changing what a visitor sees. slug and isPublished are the exception:
  // slug is a URL/identity concern, not content, and isPublished is a
  // reachability switch, not content either — both keep writing live
  // immediately, same as before. publish() is what copies draft* onto the
  // live columns.
  async update(id: string, dto: UpdatePageDto): Promise<Page> {
    const page = await this.getById(id);

    if (dto.slug !== undefined && dto.slug !== page.slug) {
      await this.assertSlugAvailable(dto.slug, id);
      page.slug = dto.slug;
    }
    if (dto.title !== undefined) page.draftTitle = dto.title;
    if (dto.seoDescription !== undefined) {
      page.draftSeoDescription = dto.seoDescription;
    }
    if (dto.isPublished !== undefined) page.isPublished = dto.isPublished;
    if (dto.theme !== undefined) page.draftTheme = dto.theme;
    if (dto.accentColor !== undefined) page.draftAccentColor = dto.accentColor;
    if (dto.backgroundColor !== undefined) {
      page.draftBackgroundColor = dto.backgroundColor;
    }
    if (dto.fontFamily !== undefined) page.draftFontFamily = dto.fontFamily;
    if (dto.showHeader !== undefined) page.draftShowHeader = dto.showHeader;
    if (dto.headerLogoUrl !== undefined) {
      page.draftHeaderLogoUrl = dto.headerLogoUrl;
    }
    if (dto.headerLinks !== undefined) page.draftHeaderLinks = dto.headerLinks;
    if (dto.sections !== undefined) {
      await this.assertValidSections(dto.sections);
      page.draftSections = dto.sections;
    }

    return this.pageRepo.save(page);
  }

  // Copies every draft* field onto its live counterpart and marks the page
  // reachable — the only place draftSections/draftTitle/etc. ever reach a
  // real visitor. Deletes the previous live OG image from Cloudinary if
  // publishing swaps it for a different one (safe here — nothing else
  // could still be pointing at it once this save commits).
  async publish(id: string): Promise<Page> {
    const page = await this.getById(id);
    await this.assertValidSections(page.draftSections);

    const previousOgImagePublicId = page.ogImagePublicId;

    page.title = page.draftTitle;
    page.seoDescription = page.draftSeoDescription;
    page.ogImageUrl = page.draftOgImageUrl;
    page.ogImagePublicId = page.draftOgImagePublicId;
    page.theme = page.draftTheme;
    page.accentColor = page.draftAccentColor;
    page.backgroundColor = page.draftBackgroundColor;
    page.fontFamily = page.draftFontFamily;
    page.showHeader = page.draftShowHeader;
    page.headerLogoUrl = page.draftHeaderLogoUrl;
    page.headerLinks = page.draftHeaderLinks;
    page.sections = page.draftSections;
    page.isPublished = true;

    const saved = await this.pageRepo.save(page);

    if (
      previousOgImagePublicId &&
      previousOgImagePublicId !== saved.ogImagePublicId
    ) {
      this.cloudinaryService.deleteByPublicId(previousOgImagePublicId, 'image');
    }

    return saved;
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
          this.optionalString(
            section.content,
            'backgroundImageUrlMobile',
            label,
          );
          this.assertPaired(section.content, 'ctaLabel', 'ctaUrl', label);
          break;
        case PageSectionType.ABOUT:
          this.requireString(section.content, 'heading', label);
          this.requireString(section.content, 'body', label);
          this.optionalString(section.content, 'imageUrl', label);
          this.optionalEnum(
            section.content,
            'layout',
            ['stacked', 'split'],
            label,
          );
          this.optionalEnum(
            section.content,
            'imagePosition',
            ['left', 'right'],
            label,
          );
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
            this.optionalString(day, 'date', dayLabel);
            this.optionalString(day, 'venue', dayLabel);
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
        case PageSectionType.MERCH:
          this.requireString(section.content, 'imageUrl', label);
          this.optionalString(section.content, 'heading', label);
          this.assertPaired(section.content, 'linkLabel', 'linkUrl', label);
          break;
        case PageSectionType.COUNTDOWN: {
          this.optionalString(section.content, 'heading', label);
          this.optionalString(section.content, 'expiredMessage', label);
          const targetDate = this.requireString(
            section.content,
            'targetDate',
            label,
          );
          if (Number.isNaN(Date.parse(targetDate))) {
            throw new BadRequestException(
              `${label}: "targetDate" must be a valid date`,
            );
          }
          break;
        }
        case PageSectionType.FOOTER:
          this.optionalString(section.content, 'heading', label);
          this.optionalString(section.content, 'text', label);
          this.optionalBoolean(section.content, 'showCopyright', label);
          this.optionalBoolean(section.content, 'showContactInfo', label);
          this.optionalArray(section.content, 'links', label, (item, i) => {
            const itemLabel = `${label}, link #${i + 1}`;
            this.requireString(item, 'label', itemLabel);
            this.requireString(item, 'url', itemLabel);
          });
          this.optionalArray(
            section.content,
            'socialLinks',
            label,
            (item, i) => {
              const itemLabel = `${label}, social link #${i + 1}`;
              const platform = item['platform'];
              if (
                typeof platform !== 'string' ||
                !FOOTER_SOCIAL_PLATFORMS.includes(
                  platform as (typeof FOOTER_SOCIAL_PLATFORMS)[number],
                )
              ) {
                throw new BadRequestException(
                  `${itemLabel}: "platform" must be one of ${FOOTER_SOCIAL_PLATFORMS.join(', ')}`,
                );
              }
              this.requireString(item, 'url', itemLabel);
            },
          );
          break;
        case PageSectionType.GALLERY: {
          this.optionalString(section.content, 'heading', label);
          this.optionalString(section.content, 'syncFolderUrl', label);
          const syncFolderUrl = section.content['syncFolderUrl'];
          const checkImage = (item: Record<string, unknown>, i: number) => {
            const itemLabel = `${label}, image #${i + 1}`;
            this.requireString(item, 'url', itemLabel);
            this.optionalString(item, 'caption', itemLabel);
          };
          if (typeof syncFolderUrl === 'string' && syncFolderUrl.trim()) {
            if (!this.galleryFolderSyncService.extractFolderId(syncFolderUrl)) {
              throw new BadRequestException(
                `${label}: "syncFolderUrl" doesn't look like a Google Drive folder link`,
              );
            }
            // Optional here — synced at render time, so a fresh section
            // doesn't need any manually-saved images to be valid.
            this.optionalArray(section.content, 'images', label, checkImage);
          } else {
            this.requireArray(section.content, 'images', label, checkImage);
          }
          break;
        }
        case PageSectionType.CHURCH_CALENDAR: {
          this.optionalString(section.content, 'heading', label);
          const calendarId = this.requireString(
            section.content,
            'calendarId',
            label,
          );
          const calendar = await this.churchCalendarService
            .getById(calendarId)
            .catch(() => null);
          if (!calendar?.isPublished) {
            throw new BadRequestException(
              `${label}: calendarId references a calendar that doesn't exist or isn't published`,
            );
          }
          await this.assertChurchCalendarEntitled();
          break;
        }
        case PageSectionType.LIVE_NOW:
          this.optionalString(section.content, 'heading', label);
          this.optionalString(section.content, 'offlineMessage', label);
          break;
      }
    }
    this.assertNoDuplicateSingletonSections(sections);
  }

  // Service-level plan check (not a controller guard) — a jsonb section
  // *type* inside a mixed array can't be gated by a route-level @RequiresPlan
  // the way a whole endpoint can. Same shape finance-request.service.ts's
  // own service-level check already uses, so the admin frontend's existing
  // axios interceptor (keyed on this exact `code`/`requiredFeature` pair)
  // pops the same upgrade-required modal for free — no new frontend needed.
  private async assertChurchCalendarEntitled(): Promise<void> {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) return;
    const { features } = await this.planFeatureResolver.resolve(tenantId);
    if (!features.includes(PlanFeature.CHURCH_CALENDAR)) {
      throw new ForbiddenException({
        message: 'The Church Calendar section requires an upgraded plan.',
        code: 'PLAN_UPGRADE_REQUIRED',
        requiredFeature: PlanFeature.CHURCH_CALENDAR,
      });
    }
  }

  // Re-checked at read time (getForPublic/getForPreview), not just at save
  // time — a section saved while the tenant was entitled must not keep
  // working forever after a downgrade. Returns true/false rather than
  // throwing, since a downgrade should silently hide the section from a
  // visitor (withChurchCalendarEntries below), never surface a permission
  // error to them.
  private async isChurchCalendarEntitled(): Promise<boolean> {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) return true;
    const { features } = await this.planFeatureResolver.resolve(tenantId);
    return features.includes(PlanFeature.CHURCH_CALENDAR);
  }

  // A page has exactly one opening banner and, if it has one at all,
  // exactly one footer — unlike REGISTRATION (documented above as
  // intentionally multi-instance, e.g. event registration + a separate
  // merch pre-order form), a second HERO or FOOTER doesn't represent
  // anything real. discuva-admin's own picker already grays these out
  // once one exists; this is defense-in-depth for the API being hit
  // directly (e.g. via Postman).
  private assertNoDuplicateSingletonSections(sections: PageSectionDto[]): void {
    const singletonTypes = [PageSectionType.HERO, PageSectionType.FOOTER];
    for (const type of singletonTypes) {
      const count = sections.filter((s) => s.type === type).length;
      if (count > 1) {
        throw new BadRequestException(
          `A page can only have one "${type}" section — found ${count}`,
        );
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

  private optionalEnum(
    content: Record<string, unknown>,
    key: string,
    allowed: readonly string[],
    label: string,
  ): void {
    const value = content[key];
    if (value === undefined || value === null) return;
    if (typeof value !== 'string' || !allowed.includes(value)) {
      throw new BadRequestException(
        `${label}: "${key}" must be one of ${allowed.join(', ')}`,
      );
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

  private optionalBoolean(
    content: Record<string, unknown>,
    key: string,
    label: string,
  ): void {
    const value = content[key];
    if (value !== undefined && value !== null && typeof value !== 'boolean') {
      throw new BadRequestException(`${label}: "${key}" must be a boolean`);
    }
  }

  // Same per-item validation as requireArray, but — unlike e.g. FAQ's
  // items — the array itself is opt-in: FOOTER's links/socialLinks are
  // extras a footer can have zero of.
  private optionalArray(
    content: Record<string, unknown>,
    key: string,
    label: string,
    checkItem: (item: Record<string, unknown>, index: number) => void,
  ): void {
    const value = content[key];
    if (value === undefined || value === null) return;
    if (!Array.isArray(value)) {
      throw new BadRequestException(`${label}: "${key}" must be an array`);
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
  // Writes draftOgImagePublicId, not the live column — see update()'s own
  // comment. The replaced image is only deleted from Cloudinary if it isn't
  // ALSO the current live ogImagePublicId; otherwise the still-published
  // page would lose its image the moment a draft replacement is uploaded,
  // before that draft is ever published.
  async setOgImage(id: string, file: Express.Multer.File): Promise<Page> {
    const page = await this.getById(id);
    const previousDraftPublicId = page.draftOgImagePublicId;
    const uploaded = await this.cloudinaryService.uploadBuffer(
      file.buffer,
      'page-images',
      undefined,
      file.mimetype,
    );
    page.draftOgImageUrl = uploaded.secureUrl;
    page.draftOgImagePublicId = uploaded.publicId;
    const saved = await this.pageRepo.save(page);
    if (
      previousDraftPublicId &&
      previousDraftPublicId !== saved.ogImagePublicId
    ) {
      this.cloudinaryService.deleteByPublicId(previousDraftPublicId, 'image');
    }
    return saved;
  }

  async removeOgImage(id: string): Promise<Page> {
    const page = await this.getById(id);
    const previousDraftPublicId = page.draftOgImagePublicId;
    page.draftOgImageUrl = null;
    page.draftOgImagePublicId = null;
    const saved = await this.pageRepo.save(page);
    if (
      previousDraftPublicId &&
      previousDraftPublicId !== saved.ogImagePublicId
    ) {
      this.cloudinaryService.deleteByPublicId(previousDraftPublicId, 'image');
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

  // Public, unauthenticated — a visitor submitting their own testimony on a
  // live page. Rejects unless the referenced section actually exists on
  // this exact page, is a TESTIMONIALS section, and has opted in via
  // content.acceptSubmissions, so a stale/guessed sectionId can't attach a
  // submission to a section that was never configured to accept one.
  // Always lands as PENDING — see withApprovedTestimonials for how an
  // APPROVED row later surfaces on the public page.
  async submitTestimonial(
    slug: string,
    dto: SubmitTestimonialDto,
  ): Promise<void> {
    const page = await this.pageRepo.findOneBy({ slug, isPublished: true });
    if (!page) throw new NotFoundException('Page not found');

    const section = page.sections.find((s) => s.id === dto.sectionId);
    if (
      !section ||
      section.type !== PageSectionType.TESTIMONIALS ||
      section.content?.acceptSubmissions !== true
    ) {
      throw new BadRequestException(
        'This page is not accepting testimonial submissions',
      );
    }

    const submission = this.testimonialSubmissionRepo.create({
      page,
      sectionId: dto.sectionId,
      quote: dto.quote,
      name: dto.name ?? null,
    });
    await this.testimonialSubmissionRepo.save(submission);
  }

  async listTestimonialSubmissions(
    pageId: string,
    status?: TestimonialSubmissionStatus,
  ): Promise<TestimonialSubmission[]> {
    await this.getById(pageId);
    return this.testimonialSubmissionRepo.find({
      where: { page: { id: pageId }, ...(status ? { status } : {}) },
      order: { createdAt: 'DESC' },
    });
  }

  async moderateTestimonialSubmission(
    pageId: string,
    submissionId: string,
    dto: ModerateTestimonialSubmissionDto,
  ): Promise<TestimonialSubmission> {
    await this.getById(pageId);
    const submission = await this.testimonialSubmissionRepo.findOneBy({
      id: submissionId,
      page: { id: pageId },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    submission.status = dto.status;
    return this.testimonialSubmissionRepo.save(submission);
  }
}
