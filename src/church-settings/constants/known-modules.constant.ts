export const KNOWN_MODULES = [
  { key: 'incident_report', moduleName: 'Incident Report', required: false },
  { key: 'asset_management', moduleName: 'Asset Management', required: false },
  { key: 'departments', moduleName: 'Departments', required: true },
  {
    key: 'service_programme',
    moduleName: 'Service Programme',
    required: true,
  },
  { key: 'evangelism', moduleName: 'Evangelism', required: false },
  { key: 'follow_up', moduleName: 'Follow-Up', required: false },
  { key: 'pastor_feedback', moduleName: 'Pastor Feedback', required: false },
  { key: 'prayer', moduleName: 'Prayer', required: false },
  { key: 'sunday_school', moduleName: 'Sunday School', required: false },
  {
    key: 'children_church',
    moduleName: "Children's Church",
    required: false,
  },
  { key: 'facility_rental', moduleName: 'Facility Rental', required: false },
  // "tithe" is the stable internal key (stored per-tenant, referenced by
  // @RequiresModule('tithe') across the tithe/finance/giving-checkout
  // modules and by the TITHE_READ/TITHE_WRITE permission names) — never
  // rename this without a data migration touching every tenant's stored
  // enabled-modules list. Kept as "Tithe & Giving" to stay consistent with
  // those permission labels ("View Tithe & Giving Records" etc.) rather
  // than drifting to a different display word than the permission picker
  // uses for the same capability. A church that doesn't use "tithe"
  // terminology can already override this via church_module_settings.displayName
  // (discuva-admin's Module Settings page supports a per-tenant rename).
  { key: 'tithe', moduleName: 'Tithe & Giving', required: false },
  { key: 'classes', moduleName: 'Training Classes', required: false },
  { key: 'announcements', moduleName: 'Announcements', required: false },
  { key: 'sermons', moduleName: 'Sermon Archive', required: false },
  { key: 'games', moduleName: 'Games', required: false },
  { key: 'service_ratings', moduleName: 'Service Ratings', required: false },
  { key: 'volunteering', moduleName: 'Volunteering', required: false },
  { key: 'small_groups', moduleName: 'Fellowships', required: false },
  { key: 'forms', moduleName: 'Forms', required: false },
  { key: 'social_media', moduleName: 'Social Media', required: false },
] as const;

export type KnownModuleKey = (typeof KNOWN_MODULES)[number]['key'];
