import { EmailCategory } from '../../utility/email-provider/email-category.enum';

export interface MemberNotificationChoice {
  category: EmailCategory;
  label: string;
  description: string;
  // Hidden while this module is off for the church.
  module?: string;
}

// Notifications a member may turn off for themselves. Anything else (duties, receipts, bookings, sign-in alerts) always sends.
export const MEMBER_NOTIFICATION_CHOICES: MemberNotificationChoice[] = [
  {
    category: EmailCategory.EVENT_REMINDER,
    label: 'Service reminders',
    description:
      "Before services and events, and a nudge when you haven't checked in yet.",
  },
  {
    category: EmailCategory.ATTENDANCE_CHECKIN,
    label: 'Check-in confirmations',
    description: 'An email after you check in to a service.',
  },
  {
    category: EmailCategory.BIRTHDAY,
    label: 'Birthday wishes',
    description: 'A message from the church on your birthday.',
  },
  {
    category: EmailCategory.MEMBERSHIP_ANNIVERSARY,
    label: 'Membership anniversary',
    description: 'A message on the anniversary of joining the church.',
  },
  {
    category: EmailCategory.PRAYER_REQUESTS,
    label: 'Prayer request updates',
    description: 'When your prayer request is prayed for or answered.',
    module: 'prayer',
  },
  {
    category: EmailCategory.FELLOWSHIPS,
    label: 'Fellowship reminders',
    description:
      'Before your fellowship meets, and for leaders, when someone keeps missing meetings.',
    module: 'small_groups',
  },
  {
    category: EmailCategory.CLASS_SESSION_REMINDER,
    label: 'Class reminders',
    description: 'Before your training class sessions.',
    module: 'classes',
  },
  {
    category: EmailCategory.NOTES,
    label: 'Notes nudges',
    description:
      'A reminder to write your sermon notes and keep your step for the week.',
    module: 'notes',
  },
  {
    category: EmailCategory.TEAM_SPACES,
    label: 'Team space updates',
    description:
      "A leader's new post, replies to your posts, and an evening summary of what you haven't read.",
    module: 'team_spaces',
  },
  {
    category: EmailCategory.BIBLE_GAMES,
    label: 'Bible game challenges',
    description: 'When someone challenges you, or it’s your turn.',
    module: 'bible_games',
  },
];

export const MUTABLE_CATEGORIES: ReadonlySet<string> = new Set(
  MEMBER_NOTIFICATION_CHOICES.map((c) => c.category),
);
