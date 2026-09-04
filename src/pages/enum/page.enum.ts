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
}
