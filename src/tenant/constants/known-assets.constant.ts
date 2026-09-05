// Every hero/backdrop image the member PWA ships a bundled default for.
// A church can override any of these; anything left unset falls back to
// the app's own bundled default at runtime (discuva-member resolves
// this, not the backend — GET /tenant/assets only ever returns what's been
// overridden, never the defaults themselves).
//
// recommendedAspectRatio matches how these actually render in
// discuva-member: every one is a full-bleed `object-cover` hero
// image inside a fixed-height container, so a mismatched upload doesn't
// break layout (object-cover always fills the container) but can crop
// awkwardly — the admin-side crop tool guides toward this ratio rather
// than the backend enforcing it as a hard rule.
export const KNOWN_ASSETS = [
  {
    key: 'login-backdrop',
    label: 'Sign-In Screen',
    description: 'Background behind the login form',
  },
  {
    key: 'onboarding-welcome',
    label: 'Welcome / Onboarding',
    description: 'First screen after a new member signs up',
  },
  {
    key: 'home-door-welcome',
    label: 'Home Screen',
    description: 'Header on the member home screen',
  },
  {
    key: 'dashboard-bible',
    label: 'Dashboard',
    description: 'Header on the personal stats dashboard',
  },
  {
    key: 'events-hero',
    label: 'Events',
    description: 'Header on the events list',
  },
  {
    key: 'church-calendar-hero',
    label: 'Church Calendar',
    description: 'Header on the church calendar list',
  },
  {
    key: 'attendance-backdrop',
    label: 'Attendance',
    description: 'Header on the check-in / attendance screen',
  },
  {
    key: 'attendance-department-backdrop',
    label: 'Department Attendance',
    description: 'Header on the HOD department attendance screen',
  },
  {
    key: 'giving-backdrop',
    label: 'Giving',
    description: 'Header on the giving / tithe screen',
  },
  {
    key: 'finance-backdrop',
    label: 'Finance Requests',
    description: 'Header on the HOD department finance/expense request screen',
  },
  {
    key: 'leave-request-backdrop',
    label: 'Leave Requests',
    description:
      'Header on worker leave requests (also used for weekly pastor feedback)',
  },
  {
    key: 'classes-backdrop',
    label: 'Training Classes',
    description: 'Header on the training classes screens',
  },
  {
    key: 'sunday-school-classroom',
    label: 'Sunday School',
    description: 'Header on the Sunday School screen',
  },
  {
    key: 'children-church-v2',
    label: "Children's Church",
    description: "Header on the children's church check-in screen",
  },
  {
    key: 'facility-rental-hall',
    label: 'Facility Rental',
    description: 'Header on the facility rental / booking screen',
  },
  {
    key: 'incident-notebook-blank',
    label: 'Incident Reports',
    description: 'Header on the incident reports screen',
  },
  {
    key: 'game-backdrop',
    label: 'Games',
    description: 'Header on the join-a-game screen',
  },
  {
    key: 'prayer-hands-bible',
    label: 'Prayer',
    description:
      'Header on prayer roster, prayer requests, and evangelism screens',
  },
  {
    key: 'follow-up-backdrop',
    label: 'Follow-Up',
    description: 'Header on the follow-up tasks screen',
  },
  {
    key: 'service-hands',
    label: 'Service History / Volunteering',
    description: 'Header on service history and volunteering screens',
  },
  {
    key: 'teamwork-hands-unity',
    label: 'Fellowships & Forms',
    description: 'Header on fellowships, department summary, and forms screens',
  },
  {
    key: 'birthday-cake-candles',
    label: 'Birthdays',
    description: 'Header on the birthday wishes screen',
  },
  {
    key: 'help-backdrop',
    label: 'Help',
    description: 'Header on the help / support screen',
  },
  {
    key: 'profile-journal',
    label: 'Profile',
    description: 'Header on profile, account, and edit-profile screens',
  },
  {
    key: 'profile-statistics',
    label: 'Dashboard Stats',
    description: 'Secondary image on the personal dashboard',
  },
  {
    key: 'security-key',
    label: 'Security Screens',
    description: 'Header on password/email change and device-reset screens',
  },
  {
    key: 'member-directory-hero',
    label: 'Member Directory',
    description: 'Header on the member directory search screen',
  },
] as const;

export type KnownAssetKey = (typeof KNOWN_ASSETS)[number]['key'];
