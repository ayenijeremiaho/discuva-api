export enum AdminPermission {
  MEMBERS_READ = 'members:read',
  MEMBERS_WRITE = 'members:write',
  EVENTS_READ = 'events:read',
  EVENTS_WRITE = 'events:write',
  VENUES_READ = 'venues:read',
  VENUES_WRITE = 'venues:write',
  DEPARTMENTS_READ = 'departments:read',
  DEPARTMENTS_WRITE = 'departments:write',
  ATTENDANCE_READ = 'attendance:read',
  ATTENDANCE_WRITE = 'attendance:write',
  LEAVE_READ = 'leave:read',
  LEAVE_WRITE = 'leave:write',
  CLASSES_READ = 'classes:read',
  CLASSES_WRITE = 'classes:write',
  ANNOUNCEMENTS_READ = 'announcements:read',
  ANNOUNCEMENTS_WRITE = 'announcements:write',
  GROUPS_READ = 'groups:read',
  GROUPS_WRITE = 'groups:write',
  NOTES_READ = 'notes:read',
  NOTES_WRITE = 'notes:write',
  DASHBOARD_READ = 'dashboard:read',
  SUNDAY_SCHOOL_READ = 'sunday_school:read',
  SUNDAY_SCHOOL_WRITE = 'sunday_school:write',
  CHILDREN_CHURCH_READ = 'children_church:read',
  CHILDREN_CHURCH_WRITE = 'children_church:write',
  ADMIN_READ = 'admin:read',
  ADMIN_WRITE = 'admin:write',
  AUDIT_READ = 'audit:read',
  EMAIL_LOGS_READ = 'email_logs:read',
  FINANCE_READ = 'finance:read',
  FINANCE_WRITE = 'finance:write',
  FOLLOW_UP_READ = 'follow_up:read',
  FOLLOW_UP_WRITE = 'follow_up:write',
  SERVICE_PROGRAMME_READ = 'service_programme:read',
  SERVICE_PROGRAMME_WRITE = 'service_programme:write',
  HEADCOUNT_READ = 'headcount:read',
  HEADCOUNT_WRITE = 'headcount:write',
  INCIDENT_REPORT_READ = 'incident_report:read',
  INCIDENT_REPORT_WRITE = 'incident_report:write',
  ASSET_MANAGEMENT_READ = 'asset_management:read',
  ASSET_MANAGEMENT_WRITE = 'asset_management:write',
  ASSET_MAINTENANCE_ALERT = 'asset_management:alert',
  FINANCE_APPROVE = 'finance:approve',
  FINANCE_RECONCILE = 'finance:reconcile',
  FINANCE_REPORT = 'finance:report',
  TITHE_READ = 'tithe:read',
  TITHE_WRITE = 'tithe:write',
  PRAYER_READ = 'prayer:read',
  PRAYER_WRITE = 'prayer:write',
  FACILITY_RENTAL_READ = 'facility_rental:read',
  FACILITY_RENTAL_WRITE = 'facility_rental:write',
  SMS_READ = 'sms:read',
  SMS_SEND = 'sms:send',
  PASTOR_FEEDBACK_READ = 'pastor_feedback:read',
  PASTOR_FEEDBACK_WRITE = 'pastor_feedback:write',
  EVANGELISM_READ = 'evangelism:read',
  EVANGELISM_WRITE = 'evangelism:write',
  SERMON_READ = 'sermon:read',
  SERMON_WRITE = 'sermon:write',
  GAMES_READ = 'games:read',
  GAMES_WRITE = 'games:write',
  SERVICE_RATING_READ = 'service_rating:read',
  SERVICE_RATING_MODERATE = 'service_rating:moderate',
  VOLUNTEER_READ = 'volunteer:read',
  VOLUNTEER_WRITE = 'volunteer:write',
  SMALL_GROUP_READ = 'small_group:read',
  SMALL_GROUP_WRITE = 'small_group:write',
  COMMUNICATION_PROVIDERS_READ = 'communication_providers:read',
  COMMUNICATION_PROVIDERS_WRITE = 'communication_providers:write',
  YOUTUBE_INTEGRATION_READ = 'youtube_integration:read',
  YOUTUBE_INTEGRATION_WRITE = 'youtube_integration:write',
  CHURCH_PROFILE_WRITE = 'church_profile:write',
  BILLING_READ = 'billing:read',
  BILLING_WRITE = 'billing:write',
  BRANCH_READ = 'branch:read',
  BRANCH_WRITE = 'branch:write',
  FORMS_READ = 'forms:read',
  FORMS_WRITE = 'forms:write',
  SOCIAL_MEDIA_READ = 'social_media:read',
  SOCIAL_MEDIA_WRITE = 'social_media:write',
  // Admin-side is read-only by design — members manage their own directory
  // profile entirely themselves; admin only ever views aggregate
  // profession/skill statistics, never edits an individual member's entry.
  MEMBER_DIRECTORY_READ = 'member_directory:read',
}

export const AdminPermissionLabels: Record<AdminPermission, string> = {
  [AdminPermission.MEMBERS_READ]: 'View Members',
  [AdminPermission.MEMBERS_WRITE]: 'Manage Members',
  [AdminPermission.EVENTS_READ]: 'View Events',
  [AdminPermission.EVENTS_WRITE]: 'Manage Events',
  [AdminPermission.VENUES_READ]: 'View Venues',
  [AdminPermission.VENUES_WRITE]: 'Manage Venues',
  [AdminPermission.DEPARTMENTS_READ]: 'View Departments',
  [AdminPermission.DEPARTMENTS_WRITE]: 'Manage Departments',
  [AdminPermission.ATTENDANCE_READ]: 'View Attendance',
  [AdminPermission.ATTENDANCE_WRITE]: 'Manage Attendance',
  [AdminPermission.LEAVE_READ]: 'View Leave Requests',
  [AdminPermission.LEAVE_WRITE]: 'Manage Leave Requests',
  [AdminPermission.CLASSES_READ]: 'View Training Classes',
  [AdminPermission.CLASSES_WRITE]: 'Manage Training Classes',
  [AdminPermission.ANNOUNCEMENTS_READ]: 'View Announcements',
  [AdminPermission.ANNOUNCEMENTS_WRITE]: 'Manage Announcements',
  [AdminPermission.GROUPS_READ]: 'View Groups',
  [AdminPermission.GROUPS_WRITE]: 'Manage Groups',
  [AdminPermission.NOTES_READ]: 'View Notes',
  [AdminPermission.NOTES_WRITE]: 'Manage Notes',
  [AdminPermission.DASHBOARD_READ]: 'View Dashboard',
  [AdminPermission.SUNDAY_SCHOOL_READ]: 'View Sunday School',
  [AdminPermission.SUNDAY_SCHOOL_WRITE]: 'Manage Sunday School',
  [AdminPermission.CHILDREN_CHURCH_READ]: "View Children's Church",
  [AdminPermission.CHILDREN_CHURCH_WRITE]: "Manage Children's Church",
  [AdminPermission.ADMIN_READ]: 'View Admin Users & Roles',
  [AdminPermission.ADMIN_WRITE]: 'Manage Admin Users & Roles',
  [AdminPermission.AUDIT_READ]: 'View Audit Logs',
  [AdminPermission.EMAIL_LOGS_READ]: 'View Email Logs',
  [AdminPermission.FINANCE_READ]: 'View Finance Records',
  [AdminPermission.FINANCE_WRITE]: 'Manage Finance Records',
  [AdminPermission.FINANCE_APPROVE]: 'Approve Finance Transactions',
  [AdminPermission.FINANCE_RECONCILE]: 'Reconcile Bank Statements',
  [AdminPermission.FINANCE_REPORT]: 'View & Receive Finance Reports',
  [AdminPermission.TITHE_READ]: 'View Tithe & Giving Records',
  [AdminPermission.TITHE_WRITE]: 'Manage Tithe Records',
  [AdminPermission.FOLLOW_UP_READ]: 'View Follow-Up',
  [AdminPermission.FOLLOW_UP_WRITE]: 'Manage Follow-Up',
  [AdminPermission.SERVICE_PROGRAMME_READ]: 'View Service Programme',
  [AdminPermission.SERVICE_PROGRAMME_WRITE]: 'Manage Service Programme',
  [AdminPermission.HEADCOUNT_READ]: 'View Service Headcount',
  [AdminPermission.HEADCOUNT_WRITE]: 'Record Service Headcount',
  [AdminPermission.INCIDENT_REPORT_READ]: 'View Incident Reports',
  [AdminPermission.INCIDENT_REPORT_WRITE]: 'Manage Incident Reports',
  [AdminPermission.ASSET_MANAGEMENT_READ]: 'View Assets',
  [AdminPermission.ASSET_MANAGEMENT_WRITE]: 'Manage Assets',
  [AdminPermission.ASSET_MAINTENANCE_ALERT]: 'Receive Maintenance Reminders',
  [AdminPermission.PRAYER_READ]: 'View Prayer Roster',
  [AdminPermission.PRAYER_WRITE]: 'Manage Prayer Roster',
  [AdminPermission.FACILITY_RENTAL_READ]: 'View Facility Bookings',
  [AdminPermission.FACILITY_RENTAL_WRITE]: 'Manage Facility Rentals',
  [AdminPermission.SMS_READ]: 'View SMS Balance & Logs',
  [AdminPermission.SMS_SEND]: 'Send SMS Messages',
  [AdminPermission.PASTOR_FEEDBACK_READ]: 'View Pastor Feedback',
  [AdminPermission.PASTOR_FEEDBACK_WRITE]: 'Manage Pastor Feedback',
  [AdminPermission.EVANGELISM_READ]: 'View Evangelism Converts',
  [AdminPermission.EVANGELISM_WRITE]: 'Manage Evangelism Converts',
  [AdminPermission.SERMON_READ]: 'View Sermon Archive',
  [AdminPermission.SERMON_WRITE]: 'Manage Sermon Archive',
  [AdminPermission.GAMES_READ]: 'View Games',
  [AdminPermission.GAMES_WRITE]: 'Manage Games',
  [AdminPermission.SERVICE_RATING_READ]: 'View Service Ratings',
  [AdminPermission.SERVICE_RATING_MODERATE]: 'Moderate Service Ratings',
  [AdminPermission.VOLUNTEER_READ]: 'View Volunteer Opportunities',
  [AdminPermission.VOLUNTEER_WRITE]: 'Manage Volunteer Opportunities',
  [AdminPermission.SMALL_GROUP_READ]: 'View Fellowships',
  [AdminPermission.SMALL_GROUP_WRITE]: 'Manage Fellowships',
  [AdminPermission.COMMUNICATION_PROVIDERS_READ]:
    'View Communication Providers',
  [AdminPermission.COMMUNICATION_PROVIDERS_WRITE]:
    'Manage Communication Providers',
  [AdminPermission.YOUTUBE_INTEGRATION_READ]: 'View YouTube Live Integration',
  [AdminPermission.YOUTUBE_INTEGRATION_WRITE]:
    'Manage YouTube Live Integration',
  [AdminPermission.CHURCH_PROFILE_WRITE]: 'Edit Church Profile',
  [AdminPermission.BILLING_READ]: 'View Plan & Billing',
  [AdminPermission.BILLING_WRITE]: 'Manage Plan & Billing',
  [AdminPermission.BRANCH_READ]: 'View Branch Overview',
  [AdminPermission.BRANCH_WRITE]: 'Manage Branches',
  [AdminPermission.FORMS_READ]: 'View Forms & Submissions',
  [AdminPermission.FORMS_WRITE]: 'Build & Manage Forms',
  [AdminPermission.SOCIAL_MEDIA_READ]: 'View Social Media Accounts & Posts',
  [AdminPermission.SOCIAL_MEDIA_WRITE]: 'Connect Accounts & Publish Posts',
  [AdminPermission.MEMBER_DIRECTORY_READ]: 'View Member Directory Analytics',
};

export const AdminPermissionDescriptions: Record<AdminPermission, string> = {
  [AdminPermission.MEMBERS_READ]:
    'View member profiles, contact details, and membership status',
  [AdminPermission.MEMBERS_WRITE]:
    'Create, update, and deactivate member accounts',
  [AdminPermission.EVENTS_READ]:
    'View events, service slots, and event configuration',
  [AdminPermission.EVENTS_WRITE]:
    'Create and manage events, service slots, and schedules',
  [AdminPermission.VENUES_READ]: 'View venue details and capacity information',
  [AdminPermission.VENUES_WRITE]: 'Add and update venue records',
  [AdminPermission.DEPARTMENTS_READ]:
    'View departments, their leads, and assigned workers',
  [AdminPermission.DEPARTMENTS_WRITE]:
    'Create and manage departments and department leads',
  [AdminPermission.ATTENDANCE_READ]:
    'View attendance records and check-in history across all services',
  [AdminPermission.ATTENDANCE_WRITE]:
    'Mark attendance manually and manage check-in overrides',
  [AdminPermission.LEAVE_READ]:
    'View worker leave requests and their current statuses',
  [AdminPermission.LEAVE_WRITE]: 'Approve or reject worker leave requests',
  [AdminPermission.CLASSES_READ]:
    'View training classes, topics, and enrollment records',
  [AdminPermission.CLASSES_WRITE]:
    'Create and manage training classes and member enrollments',
  [AdminPermission.ANNOUNCEMENTS_READ]:
    'View all announcements sent to members or workers',
  [AdminPermission.ANNOUNCEMENTS_WRITE]:
    'Create and publish announcements to members or workers',
  [AdminPermission.GROUPS_READ]: 'View groups and their member rosters',
  [AdminPermission.GROUPS_WRITE]:
    'Create and manage groups, and add or remove members individually or in bulk',
  [AdminPermission.NOTES_READ]:
    'View pastoral notes and member interaction records',
  [AdminPermission.NOTES_WRITE]: 'Create and assign pastoral notes to members',
  [AdminPermission.DASHBOARD_READ]:
    'Access the admin overview dashboard and summary statistics',
  [AdminPermission.SUNDAY_SCHOOL_READ]:
    'View Sunday School classes, sessions, and attendance records',
  [AdminPermission.SUNDAY_SCHOOL_WRITE]:
    'Manage Sunday School sessions and mark member attendance',
  [AdminPermission.CHILDREN_CHURCH_READ]:
    "View children's church records, check-in history, and guardian info",
  [AdminPermission.CHILDREN_CHURCH_WRITE]:
    "Manage children's church check-ins and guardian records",
  [AdminPermission.ADMIN_READ]:
    'View admin accounts, roles, and their assigned permission sets',
  [AdminPermission.ADMIN_WRITE]:
    'Create admin accounts, define roles, and assign permissions to roles',
  [AdminPermission.AUDIT_READ]:
    'View audit logs and system-wide activity history',
  [AdminPermission.EMAIL_LOGS_READ]:
    'View email delivery logs including sent and failed email records',
  [AdminPermission.FINANCE_READ]:
    'View ledger entries, accounts, budgets, offerings, and reconciliation records — excludes individual member tithe and giving data',
  [AdminPermission.FINANCE_WRITE]:
    'Post journal entries, record offerings, manage chart of accounts, and process petty cash',
  [AdminPermission.FINANCE_APPROVE]:
    'Approve journal entries above the configured threshold and approve finance requests',
  [AdminPermission.FINANCE_RECONCILE]:
    'Upload and confirm bank statement CSV files, categorise imported transactions',
  [AdminPermission.FINANCE_REPORT]:
    'Generate and receive scheduled financial reports including income & expenditure, cash flow, and trial balance',
  [AdminPermission.TITHE_READ]:
    'View individual member tithe records, giving history, and annual giving statements',
  [AdminPermission.TITHE_WRITE]:
    'Confirm tithe records and manage tithe accounts',
  [AdminPermission.FOLLOW_UP_READ]: 'View follow-up tasks and their progress',
  [AdminPermission.FOLLOW_UP_WRITE]:
    'Create and assign follow-up tasks to workers',
  [AdminPermission.SERVICE_PROGRAMME_READ]:
    'View service programmes, session history, reports, and analytics',
  [AdminPermission.SERVICE_PROGRAMME_WRITE]:
    'Create and manage service programmes, slots, and reusable templates',
  [AdminPermission.HEADCOUNT_READ]:
    'View service attendance headcounts and trends across all services',
  [AdminPermission.HEADCOUNT_WRITE]:
    'Record and correct physical attendance headcounts after each service',
  [AdminPermission.INCIDENT_REPORT_READ]:
    'View all incident reports, reporter identity, and admin notes',
  [AdminPermission.INCIDENT_REPORT_WRITE]:
    'Update incident status, add admin notes, and receive new-incident notifications',
  [AdminPermission.ASSET_MANAGEMENT_READ]:
    'View asset registry, maintenance schedules, and maintenance history',
  [AdminPermission.ASSET_MANAGEMENT_WRITE]:
    'Create and manage assets, log scheduled and unplanned maintenance records',
  [AdminPermission.ASSET_MAINTENANCE_ALERT]:
    'Receive email reminders for upcoming and overdue asset maintenance',
  [AdminPermission.PRAYER_READ]:
    'View monthly prayer roster, day configurations, rules, and fixed assignments',
  [AdminPermission.PRAYER_WRITE]:
    'Manage prayer roster — configure days, rules, fixed assignments, generate and close rosters, and reschedule workers',
  [AdminPermission.FACILITY_RENTAL_READ]:
    'View facility bookings, pricing tiers, add-ons, and availability calendar',
  [AdminPermission.FACILITY_RENTAL_WRITE]:
    'Manage facilities, pricing tiers, add-ons, confirm or reject bookings, apply discount overrides, and record payments',
  [AdminPermission.SMS_READ]:
    'View SMS balance, per-message cost estimates, and delivery logs',
  [AdminPermission.SMS_SEND]:
    'Send SMS messages, including enabling SMS delivery on announcements',
  [AdminPermission.PASTOR_FEEDBACK_READ]:
    'View weekly pastor feedback submissions and responses across all departments',
  [AdminPermission.PASTOR_FEEDBACK_WRITE]:
    'Edit or delete pastor feedback submissions, and respond as a pastor',
  [AdminPermission.EVANGELISM_READ]:
    'View all evangelism converts, follow-up history, and assignments',
  [AdminPermission.EVANGELISM_WRITE]:
    'Reassign convert follow-up ownership and link converts to member records',
  [AdminPermission.SERMON_READ]: 'View sermon archive entries',
  [AdminPermission.SERMON_WRITE]:
    'Create, edit, and delete sermon archive entries, and trigger "we\'re live" announcements',
  [AdminPermission.GAMES_READ]:
    'View games, questions, sessions, and leaderboards',
  [AdminPermission.GAMES_WRITE]:
    'Create and edit games and questions, and start/control/end live game sessions',
  [AdminPermission.SERVICE_RATING_READ]:
    'View aggregate service ratings and the anonymized comment feed',
  [AdminPermission.SERVICE_RATING_MODERATE]:
    'Reveal the member identity behind a rating comment and delete/hide it',
  [AdminPermission.VOLUNTEER_READ]:
    'View volunteer opportunities and their sign-up rosters',
  [AdminPermission.VOLUNTEER_WRITE]:
    'Create, edit, and cancel volunteer opportunities',
  [AdminPermission.SMALL_GROUP_READ]:
    'View fellowships, rosters, and attendance history',
  [AdminPermission.SMALL_GROUP_WRITE]:
    'Create, edit, and delete fellowships; assign leaders; remove members',
  [AdminPermission.COMMUNICATION_PROVIDERS_READ]:
    'View which SMS/email providers this church has configured',
  [AdminPermission.COMMUNICATION_PROVIDERS_WRITE]:
    "Set this church's own SMS/email provider credentials (BYOK) and enable or disable them",
  [AdminPermission.YOUTUBE_INTEGRATION_READ]:
    "View this church's YouTube live-detection integration status",
  [AdminPermission.YOUTUBE_INTEGRATION_WRITE]:
    "Set this church's YouTube channel and API key for automatic live-stream announcements, and enable or disable it",
  [AdminPermission.CHURCH_PROFILE_WRITE]:
    "Edit this church's own name, logo, tagline, address, support email, currency, and timezone",
  [AdminPermission.BILLING_READ]:
    "View this church's current plan and subscription status",
  [AdminPermission.BILLING_WRITE]:
    'Initiate a plan upgrade checkout or cancel the current subscription',
  [AdminPermission.BRANCH_READ]:
    "View this church's branch hierarchy and each branch's rollup stats (member count, attendance, giving)",
  [AdminPermission.BRANCH_WRITE]:
    'Invite a new branch church and manage the branch hierarchy link',
  [AdminPermission.FORMS_READ]:
    'View forms and their submissions, and export submissions as CSV',
  [AdminPermission.FORMS_WRITE]:
    'Create, edit, and delete forms and their fields',
  [AdminPermission.SOCIAL_MEDIA_READ]:
    'View connected social media accounts and post history',
  [AdminPermission.SOCIAL_MEDIA_WRITE]:
    'Connect/disconnect social accounts, compose posts, and publish to multiple platforms at once',
  [AdminPermission.MEMBER_DIRECTORY_READ]:
    "View aggregate profession/skill statistics for opted-in members — never an individual member's directory entry beyond what search already shows",
};

export interface AdminPermissionGroupItem {
  value: AdminPermission;
  label: string;
  description: string;
}

export interface AdminPermissionGroup {
  group: string;
  // Church-settings module key this group maps to, if any (see KNOWN_MODULES
  // in src/church-settings). Lets the frontend hide the group from role
  // management when the church has disabled that module. Left undefined for
  // groups that mix permissions across modules or map to a required
  // (non-toggleable) module — hiding those would risk hiding something a
  // church still needs.
  moduleKey?: string;
  permissions: AdminPermissionGroupItem[];
}

function buildGroup(
  group: string,
  keys: AdminPermission[],
  moduleKey?: string,
): AdminPermissionGroup {
  return {
    group,
    moduleKey,
    permissions: keys.map((value) => ({
      value,
      label: AdminPermissionLabels[value],
      description: AdminPermissionDescriptions[value],
    })),
  };
}

// Served live via GET /enums (EnumsController — `adminPermissionGroups`
// field) rather than hand-copied into discuva-admin as a second constant.
// discuva-admin used to hardcode its own duplicate of this list and it
// silently drifted out of sync as permissions were added over time,
// eventually showing a confusing "80 of 67 selected" count on the role
// editor — any new permission added here is picked up automatically once
// it's in a group below, no second file to remember.
export const AdminPermissionGroups: AdminPermissionGroup[] = [
  buildGroup('Members', [
    AdminPermission.MEMBERS_READ,
    AdminPermission.MEMBERS_WRITE,
  ]),
  buildGroup('Events & Venues', [
    AdminPermission.EVENTS_READ,
    AdminPermission.EVENTS_WRITE,
    AdminPermission.VENUES_READ,
    AdminPermission.VENUES_WRITE,
  ]),
  buildGroup('Departments', [
    AdminPermission.DEPARTMENTS_READ,
    AdminPermission.DEPARTMENTS_WRITE,
  ]),
  buildGroup('Attendance', [
    AdminPermission.ATTENDANCE_READ,
    AdminPermission.ATTENDANCE_WRITE,
  ]),
  buildGroup('Service Programme', [
    AdminPermission.SERVICE_PROGRAMME_READ,
    AdminPermission.SERVICE_PROGRAMME_WRITE,
  ]),
  buildGroup('Service Headcount', [
    AdminPermission.HEADCOUNT_READ,
    AdminPermission.HEADCOUNT_WRITE,
  ]),
  buildGroup(
    'Sunday School',
    [AdminPermission.SUNDAY_SCHOOL_READ, AdminPermission.SUNDAY_SCHOOL_WRITE],
    'sunday_school',
  ),
  buildGroup(
    "Children's Church",
    [
      AdminPermission.CHILDREN_CHURCH_READ,
      AdminPermission.CHILDREN_CHURCH_WRITE,
    ],
    'children_church',
  ),
  buildGroup(
    'Training Classes',
    [AdminPermission.CLASSES_READ, AdminPermission.CLASSES_WRITE],
    'classes',
  ),
  buildGroup('Leave Requests', [
    AdminPermission.LEAVE_READ,
    AdminPermission.LEAVE_WRITE,
  ]),
  buildGroup('Finance', [
    AdminPermission.FINANCE_READ,
    AdminPermission.FINANCE_WRITE,
    AdminPermission.FINANCE_APPROVE,
    AdminPermission.FINANCE_RECONCILE,
    AdminPermission.FINANCE_REPORT,
  ]),
  buildGroup(
    'Tithe & Giving',
    [AdminPermission.TITHE_READ, AdminPermission.TITHE_WRITE],
    'tithe',
  ),
  buildGroup(
    'Announcements',
    [
      AdminPermission.ANNOUNCEMENTS_READ,
      AdminPermission.ANNOUNCEMENTS_WRITE,
      AdminPermission.GROUPS_READ,
      AdminPermission.GROUPS_WRITE,
    ],
    'announcements',
  ),
  buildGroup('Notes & Follow-Up', [
    AdminPermission.NOTES_READ,
    AdminPermission.NOTES_WRITE,
    AdminPermission.FOLLOW_UP_READ,
    AdminPermission.FOLLOW_UP_WRITE,
  ]),
  buildGroup(
    'Incident Reports',
    [
      AdminPermission.INCIDENT_REPORT_READ,
      AdminPermission.INCIDENT_REPORT_WRITE,
    ],
    'incident_report',
  ),
  buildGroup(
    'Asset Management',
    [
      AdminPermission.ASSET_MANAGEMENT_READ,
      AdminPermission.ASSET_MANAGEMENT_WRITE,
      AdminPermission.ASSET_MAINTENANCE_ALERT,
    ],
    'asset_management',
  ),
  buildGroup(
    'Prayer Roster',
    [AdminPermission.PRAYER_READ, AdminPermission.PRAYER_WRITE],
    'prayer',
  ),
  buildGroup(
    'Facility Rental',
    [
      AdminPermission.FACILITY_RENTAL_READ,
      AdminPermission.FACILITY_RENTAL_WRITE,
    ],
    'facility_rental',
  ),
  buildGroup('SMS Messaging', [
    AdminPermission.SMS_READ,
    AdminPermission.SMS_SEND,
  ]),
  buildGroup(
    'Pastor Feedback',
    [
      AdminPermission.PASTOR_FEEDBACK_READ,
      AdminPermission.PASTOR_FEEDBACK_WRITE,
    ],
    'pastor_feedback',
  ),
  buildGroup(
    'Evangelism',
    [AdminPermission.EVANGELISM_READ, AdminPermission.EVANGELISM_WRITE],
    'evangelism',
  ),
  buildGroup(
    'Sermon Archive',
    [AdminPermission.SERMON_READ, AdminPermission.SERMON_WRITE],
    'sermons',
  ),
  buildGroup(
    'Games',
    [AdminPermission.GAMES_READ, AdminPermission.GAMES_WRITE],
    'games',
  ),
  buildGroup(
    'Service Ratings',
    [
      AdminPermission.SERVICE_RATING_READ,
      AdminPermission.SERVICE_RATING_MODERATE,
    ],
    'service_ratings',
  ),
  buildGroup(
    'Volunteering',
    [AdminPermission.VOLUNTEER_READ, AdminPermission.VOLUNTEER_WRITE],
    'volunteering',
  ),
  buildGroup(
    'Fellowships',
    [AdminPermission.SMALL_GROUP_READ, AdminPermission.SMALL_GROUP_WRITE],
    'small_groups',
  ),
  buildGroup('Communication Providers', [
    AdminPermission.COMMUNICATION_PROVIDERS_READ,
    AdminPermission.COMMUNICATION_PROVIDERS_WRITE,
  ]),
  buildGroup('YouTube Integration', [
    AdminPermission.YOUTUBE_INTEGRATION_READ,
    AdminPermission.YOUTUBE_INTEGRATION_WRITE,
  ]),
  buildGroup('Church Profile', [AdminPermission.CHURCH_PROFILE_WRITE]),
  buildGroup('Billing & Plan', [
    AdminPermission.BILLING_READ,
    AdminPermission.BILLING_WRITE,
  ]),
  buildGroup('Branches', [
    AdminPermission.BRANCH_READ,
    AdminPermission.BRANCH_WRITE,
  ]),
  buildGroup(
    'Forms',
    [AdminPermission.FORMS_READ, AdminPermission.FORMS_WRITE],
    'forms',
  ),
  buildGroup(
    'Social Media',
    [AdminPermission.SOCIAL_MEDIA_READ, AdminPermission.SOCIAL_MEDIA_WRITE],
    'social_media',
  ),
  buildGroup(
    'Member Directory',
    [AdminPermission.MEMBER_DIRECTORY_READ],
    'member_directory',
  ),
  buildGroup('Administration', [
    AdminPermission.DASHBOARD_READ,
    AdminPermission.ADMIN_READ,
    AdminPermission.ADMIN_WRITE,
    AdminPermission.AUDIT_READ,
    AdminPermission.EMAIL_LOGS_READ,
  ]),
];
