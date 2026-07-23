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
  { key: 'tithe', moduleName: 'Tithe & Giving', required: false },
  { key: 'classes', moduleName: 'Training Classes', required: false },
  { key: 'announcements', moduleName: 'Announcements', required: false },
  { key: 'sermons', moduleName: 'Sermon Archive', required: false },
  { key: 'games', moduleName: 'Games', required: false },
  { key: 'service_ratings', moduleName: 'Service Ratings', required: false },
  { key: 'volunteering', moduleName: 'Volunteering', required: false },
  { key: 'small_groups', moduleName: 'Fellowships', required: false },
] as const;

export type KnownModuleKey = (typeof KNOWN_MODULES)[number]['key'];
