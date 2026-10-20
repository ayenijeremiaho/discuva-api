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
    key: 'more-hero',
    label: 'More',
    description: 'Header on the More screen',
    // Starts as the same picture as profile-journal, but changes on its own.
    defaultImage: 'profile-journal',
  },
  {
    key: 'profile-journal',
    label: 'My Account',
    description:
      'Header on My Account, its Notifications and Appearance screens, and Edit Profile',
  },
  {
    key: 'profile-statistics',
    label: 'My Stats',
    description: 'Header on the My Stats screen',
  },
  {
    key: 'my-week-hero',
    label: 'My Week',
    description: 'Header on the My Week screen',
    // Starts as the same picture as profile-journal, but changes on its own.
    defaultImage: 'profile-journal',
  },
  {
    key: 'my-journey-hero',
    label: 'My Journey',
    description: 'Header on the My Journey screen',
    // Starts as the same picture as profile-journal, but changes on its own.
    defaultImage: 'profile-journal',
  },
  {
    key: 'whats-new-hero',
    label: "What's New",
    description: "Header on the What's New screen",
    // Starts as the same picture as profile-journal, but changes on its own.
    defaultImage: 'profile-journal',
  },
  {
    key: 'events-hero',
    label: 'Events',
    description: 'Header on the events list and the public event page',
  },
  {
    key: 'church-calendar-hero',
    label: 'Church Calendar',
    description: 'Header on the church calendar list',
  },
  {
    key: 'attendance-backdrop',
    label: 'Attendance',
    description: 'Header on the My Attendance screen',
  },
  {
    key: 'admin-checkin-hero',
    label: 'Check Someone In',
    description: 'Header on the admin department Check Someone In screen',
    // Starts as the same picture as attendance-backdrop, but changes on its own.
    defaultImage: 'attendance-backdrop',
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
    description: 'Header on the worker Leave Requests screen',
  },
  {
    key: 'pastor-feedback-hero',
    label: 'Weekly Feedback',
    description: 'Header on the weekly pastor feedback screen',
    // Starts as the same picture as leave-request-backdrop, but changes on its own.
    defaultImage: 'leave-request-backdrop',
  },
  {
    key: 'classes-backdrop',
    label: 'Training Classes',
    description: 'Header on the training classes list and each class page',
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
    description: 'Header on the Games screen and My quiz history (shown muted)',
  },
  {
    key: 'prayer-hands-bible',
    label: 'Prayer',
    description: 'Header on the Prayer Roster and Prayer Requests screens',
  },
  {
    key: 'evangelism-hero',
    label: 'Evangelism',
    description: 'Header on the evangelism (converts) screen',
    // Starts as the same picture as prayer-hands-bible, but changes on its own.
    defaultImage: 'prayer-hands-bible',
  },
  {
    key: 'follow-up-backdrop',
    label: 'Follow-Up',
    description: 'Header on the follow-up tasks screen',
  },
  {
    key: 'service-hands',
    label: 'Service History',
    description: 'Header on the Service History screen',
  },
  {
    key: 'order-of-service-hero',
    label: 'Order of Service',
    description: 'Header on the Order of Service screen',
    // Starts as the same picture as service-hands, but changes on its own.
    defaultImage: 'service-hands',
  },
  {
    key: 'programme-planner-hero',
    label: 'Plan Services',
    description: 'Header on the Plan Services screen for programme planners',
    // Starts as the same picture as events-hero, but changes on its own.
    defaultImage: 'events-hero',
  },
  {
    key: 'volunteering-hero',
    label: 'Volunteering',
    description: 'Header on the Volunteering screen',
    // Starts as the same picture as service-hands, but changes on its own.
    defaultImage: 'service-hands',
  },
  {
    key: 'serving-rota-hero',
    label: 'Serving Rota',
    description: 'Header on the Serving Rota screens',
    // Starts as the same picture as service-hands, but changes on its own.
    defaultImage: 'service-hands',
  },
  {
    key: 'teamwork-hands-unity',
    label: 'Fellowships',
    description: 'Header on the fellowships list and each fellowship page',
  },
  {
    key: 'forms-hero',
    label: 'Forms',
    description: 'Header on the Forms screen and My Scores & Votes',
    // Starts as the same picture as teamwork-hands-unity, but changes on its own.
    defaultImage: 'teamwork-hands-unity',
  },
  {
    key: 'department-goals-hero',
    label: 'Department Goals',
    description: 'Header on the Department Goals screen',
    // Starts as the same picture as teamwork-hands-unity, but changes on its own.
    defaultImage: 'teamwork-hands-unity',
  },
  {
    key: 'department-summary-hero',
    label: 'Department Summary',
    description: 'Header on the HOD Department Summary screen',
    // Starts as the same picture as teamwork-hands-unity, but changes on its own.
    defaultImage: 'teamwork-hands-unity',
  },
  {
    key: 'team-pulse-hero',
    label: 'Team Pulse',
    description: 'Header on the Team Pulse screens',
    // Starts as the same picture as teamwork-hands-unity, but changes on its own.
    defaultImage: 'teamwork-hands-unity',
  },
  {
    key: 'team-spaces-hero',
    label: 'Team Spaces',
    description: 'Header on the Team Spaces screens',
    // Starts as the same picture as teamwork-hands-unity, but changes on its own.
    defaultImage: 'teamwork-hands-unity',
  },
  {
    key: 'dashboard-bible',
    label: 'Sermons',
    description: 'Header on the sermon archive',
  },
  {
    key: 'notes-hero',
    label: 'Notes',
    description: 'Header on the My notes screen',
    // Starts as the same picture as dashboard-bible, but changes on its own.
    defaultImage: 'dashboard-bible',
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
    key: 'security-key',
    label: 'Security Screens',
    description:
      'Header on password/email change, forgot password, device-reset and biometric login screens',
  },
  {
    key: 'member-directory-hero',
    label: 'Member Directory',
    description: 'Header on the member directory search screen',
  },
] as const;

// The bundled default the member app falls back to (public/images/<file>.jpg): the key itself unless defaultImage says otherwise.
export function defaultImageFor(key: string): string {
  const asset = KNOWN_ASSETS.find((a) => a.key === key);
  return asset && 'defaultImage' in asset ? asset.defaultImage : key;
}

export type KnownAssetKey = (typeof KNOWN_ASSETS)[number]['key'];
