// Values must match the strings seeded into plans.features in
// src/migrations/1790640000000-AddPlatformControlPlaneTables.ts — PlanGuard
// checks membership against that array directly (see
// docs/MULTI_TENANT_MIGRATION.md §4.11).
export enum PlanFeature {
  FINANCE = 'finance',
  SMS = 'sms',
  FACILITY_RENTAL = 'facility_rental',
  GAMES = 'games',
  VOLUNTEER = 'volunteer',
  ASSET_MANAGEMENT = 'asset_management',
  INCIDENT_REPORT = 'incident_report',
  AUDIT = 'audit',
  SERVICE_PROGRAMME = 'service_programme',
  SERVICE_RATING = 'service_rating',
  SERMON = 'sermon',
  BULK_EXPORT = 'bulk_export',
  FORMS = 'forms',
  MEMBER_DIRECTORY = 'member_directory',
  CHURCH_CALENDAR = 'church_calendar',
}
