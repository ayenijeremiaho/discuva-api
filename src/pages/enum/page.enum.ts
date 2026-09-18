// The fixed section toolkit a Page is built from — see Page.sections' own
// comment for how each type's `content` shape is validated. Adding a new
// type later is additive (new enum value + PageService.assertValidSection
// branch), not a schema change, since content is jsonb.
export enum PageSectionType {
  HERO = 'HERO',
  ABOUT = 'ABOUT',
  STATS = 'STATS',
  SPEAKERS = 'SPEAKERS',
  SCHEDULE = 'SCHEDULE',
  // content.formId embeds an existing Form inline (rendered via the same
  // FormFillFields/PaginatedFormFillFields components a form's own public
  // fill page already uses) rather than reimplementing registration.
  REGISTRATION = 'REGISTRATION',
  TESTIMONIALS = 'TESTIMONIALS',
  FAQ = 'FAQ',
  // A single promotional image/poster plus an optional CTA link — e.g. a
  // merch flyer or a pre-order banner.
  MERCH = 'MERCH',
  // A live days/hours/minutes/seconds countdown to content.targetDate — the
  // one section type whose content carries a REAL machine-readable instant
  // rather than free text, unlike HERO's dateRangeText/SCHEDULE's day
  // labels (see PageService.assertValidSections' own comment on this case).
  COUNTDOWN = 'COUNTDOWN',
  // Optional, explicit — a page with none still gets a minimal automatic
  // footer (church name + copyright line, from PublicPageDto.church) at
  // the very bottom of app/p/[slug]/page.tsx, unrelated to `sections`
  // entirely. Adding this section type lets an admin REPLACE that minimal
  // default with a fuller one (custom text, custom links, social links,
  // church contact info) — see PageService.assertValidSections' FOOTER
  // case for its content shape.
  FOOTER = 'FOOTER',
  // A responsive image grid — content.images is authored directly (like
  // SPEAKERS' items), not pulled from elsewhere. Free on any tenant with
  // the 'pages' module enabled, no plan gate.
  GALLERY = 'GALLERY',
  // content.calendarId references an existing ChurchCalendar by id — this
  // section does NOT re-author entries, it pulls the referenced calendar's
  // `entries` live at render time (PageService.withChurchCalendarEntries),
  // the same "reference another entity, merge its data server-side"
  // pattern REGISTRATION's formId already uses. Paid-plan gated
  // (PlanFeature.CHURCH_CALENDAR) — see assertValidSections' own case and
  // withChurchCalendarEntries for the downgrade-handling story.
  CHURCH_CALENDAR = 'CHURCH_CALENDAR',
  // No content to author beyond a heading/offline message — always
  // reflects "is a service live right now, tenant-wide" at render time
  // (PageService.withLiveStatus), pulled from ServiceSessionService. Free,
  // no plan gate.
  LIVE_NOW = 'LIVE_NOW',
}

// The only status values allowed for TestimonialSubmission.status — plain
// string column, never a native PG enum, matching every other status field
// in this codebase.
export enum TestimonialSubmissionStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

// Shared shape for a section's optional style overrides — unlike `content`,
// this doesn't vary per PageSectionType, so both the entity (Page.sections'
// PageSection) and the DTO (page.dto.ts's SectionStyleDto, which adds the
// actual class-validator decorators) type against this same interface
// rather than duplicating the 5 fields, or the entity falling back to an
// untyped `Record<string, unknown>` the way `content` intentionally does.
export interface SectionStyle {
  align?: 'left' | 'center' | 'right';
  columns?: 1 | 2 | 3 | 4;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  accentColor?: string | null;
  // Vertical breathing room above/below the section — unlike the other 4
  // fields (each applicable to only some section types), spacing is a
  // universal layout concern and applies to every PageSectionType, replacing
  // the flat `py-16` every section used before this existed. Null/unset
  // keeps that original `py-16`.
  spacing?: 'sm' | 'md' | 'lg';
  // Only meaningful for REGISTRATION today — 'split' puts the heading/body
  // in one column and the embedded form card in the other, side by side
  // (mirrors ABOUT.content.layout's own stacked/split concept, but as a
  // style knob rather than content since it's a page-builder layout choice,
  // not something the section's meaning depends on). When 'split', `align`
  // is repurposed to mean which side the FORM card sits on ('left' | not
  // 'left' → right, same "unset defaults to the same side ABOUT's own
  // imagePosition defaults to" convention) instead of its usual whole-block
  // shift. Unset/'stacked' keeps the original single-column card layout.
  layout?: 'stacked' | 'split';
}
