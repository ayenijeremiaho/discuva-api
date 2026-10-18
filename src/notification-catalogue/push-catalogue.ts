import { EmailCategory } from '../utility/email-provider/email-category.enum';

export enum PushNotificationKey {
  PRAYER_SCHEDULE_SET = 'PRAYER_SCHEDULE_SET',
  PRAYER_ASSIGNED = 'PRAYER_ASSIGNED',
  PRAYER_ASSIGNMENT_REMOVED = 'PRAYER_ASSIGNMENT_REMOVED',
  PRAYER_RESCHEDULED = 'PRAYER_RESCHEDULED',
  PRAYER_SELECTION_OPEN = 'PRAYER_SELECTION_OPEN',
  PRAYER_REMINDER_TWO_DAYS = 'PRAYER_REMINDER_TWO_DAYS',
  PRAYER_REMINDER_TODAY = 'PRAYER_REMINDER_TODAY',
  SUNDAY_SCHOOL_QUESTION_ASKED = 'SUNDAY_SCHOOL_QUESTION_ASKED',
  SUNDAY_SCHOOL_QUESTION_UNASSIGNED = 'SUNDAY_SCHOOL_QUESTION_UNASSIGNED',
  SUNDAY_SCHOOL_QUESTION_ANSWERED = 'SUNDAY_SCHOOL_QUESTION_ANSWERED',
  SUNDAY_SCHOOL_CHECKIN_OPEN = 'SUNDAY_SCHOOL_CHECKIN_OPEN',
  SUNDAY_SCHOOL_ABSENTEES = 'SUNDAY_SCHOOL_ABSENTEES',
  CLASS_JOIN_APPROVED = 'CLASS_JOIN_APPROVED',
  CLASS_JOIN_DECLINED = 'CLASS_JOIN_DECLINED',
  CLASS_CERTIFICATE_READY = 'CLASS_CERTIFICATE_READY',
  PASTOR_FEEDBACK_REMINDER = 'PASTOR_FEEDBACK_REMINDER',
  PASTOR_FEEDBACK_RESPONSE = 'PASTOR_FEEDBACK_RESPONSE',
  SERVICE_SLOT_ASSIGNED = 'SERVICE_SLOT_ASSIGNED',
  SERVICE_SLOT_BACKUP = 'SERVICE_SLOT_BACKUP',
  SERVICE_SLOT_TEAM_ASSIGNED = 'SERVICE_SLOT_TEAM_ASSIGNED',
  SERVICE_SLOT_REMINDER = 'SERVICE_SLOT_REMINDER',
  SERVICE_REMINDER = 'SERVICE_REMINDER',
  GOAL_CHANGES_REQUESTED = 'GOAL_CHANGES_REQUESTED',
  GOAL_LEVEL_APPROVED = 'GOAL_LEVEL_APPROVED',
  GOAL_FULLY_APPROVED = 'GOAL_FULLY_APPROVED',
  GOAL_NEW_COMMENT = 'GOAL_NEW_COMMENT',
  OUTREACH_TEAM_ADDED = 'OUTREACH_TEAM_ADDED',
  CONVERT_ASSIGNED = 'CONVERT_ASSIGNED',
  CONVERTS_BULK_ASSIGNED = 'CONVERTS_BULK_ASSIGNED',
  CONVERT_VISITED_CHURCH = 'CONVERT_VISITED_CHURCH',
  NOTE_EVENING_NUDGE = 'NOTE_EVENING_NUDGE',
  NOTE_COMMITMENT_REMINDER = 'NOTE_COMMITMENT_REMINDER',
  BIBLE_DUEL_INVITE = 'BIBLE_DUEL_INVITE',
  BIBLE_DUEL_YOUR_TURN = 'BIBLE_DUEL_YOUR_TURN',
  BIBLE_DUEL_FINISHED = 'BIBLE_DUEL_FINISHED',
  PRAYER_REQUEST_PRAYED_FOR = 'PRAYER_REQUEST_PRAYED_FOR',
  PRAYER_REQUEST_ANSWERED = 'PRAYER_REQUEST_ANSWERED',
  RENTAL_BOOKING_CONFIRMED = 'RENTAL_BOOKING_CONFIRMED',
  RENTAL_BOOKING_REJECTED = 'RENTAL_BOOKING_REJECTED',
  RENTAL_PAYMENT_RECEIVED = 'RENTAL_PAYMENT_RECEIVED',
  RENTAL_CAUTION_REFUNDED = 'RENTAL_CAUTION_REFUNDED',
  RENTAL_BOOKING_REMINDER = 'RENTAL_BOOKING_REMINDER',
  FELLOWSHIP_MEMBER_MISSING = 'FELLOWSHIP_MEMBER_MISSING',
  FELLOWSHIP_MEETING_REMINDER = 'FELLOWSHIP_MEETING_REMINDER',
}

export interface PushTemplate {
  category: EmailCategory;
  label: string;
  description: string;
  title: string;
  body: string;
  url: string;
  // Placeholder name -> sample value, for validation and previews.
  placeholders: Record<string, string>;
}

export const PUSH_TITLE_MAX = 60;
export const PUSH_BODY_MAX = 150;

// Single source of every push's default wording; senders pass a key plus placeholder values.
export const PUSH_CATALOGUE: Record<PushNotificationKey, PushTemplate> = {
  [PushNotificationKey.PRAYER_SCHEDULE_SET]: {
    category: EmailCategory.PRAYER_REMINDER,
    label: 'Monthly prayer schedule set',
    description: "Sent to workers when the month's prayer roster is generated.",
    title: 'Prayer Schedule Updated',
    body: 'Your prayer schedule for the month has been set.',
    url: '/prayer',
    placeholders: {},
  },
  [PushNotificationKey.PRAYER_ASSIGNED]: {
    category: EmailCategory.PRAYER_REMINDER,
    label: 'Prayer meeting assigned',
    description: 'Sent when someone is added to a prayer meeting.',
    title: 'Prayer Assignment',
    body: 'You have been assigned to a prayer meeting on {{meeting_date}}.',
    url: '/prayer',
    placeholders: { meeting_date: '2026-10-04' },
  },
  [PushNotificationKey.PRAYER_ASSIGNMENT_REMOVED]: {
    category: EmailCategory.PRAYER_REMINDER,
    label: 'Prayer assignment removed',
    description: 'Sent when someone is taken off a prayer meeting.',
    title: 'Prayer Assignment Removed',
    body: 'Your prayer assignment has been removed.',
    url: '/prayer',
    placeholders: {},
  },
  [PushNotificationKey.PRAYER_RESCHEDULED]: {
    category: EmailCategory.PRAYER_REMINDER,
    label: 'Prayer meeting rescheduled',
    description: "Sent when someone's prayer meeting moves to another date.",
    title: 'Prayer Rescheduled',
    body: 'Your prayer meeting has been rescheduled to {{meeting_date}}.',
    url: '/prayer',
    placeholders: { meeting_date: '2026-10-11' },
  },
  [PushNotificationKey.PRAYER_SELECTION_OPEN]: {
    category: EmailCategory.PRAYER_REMINDER,
    label: 'Prayer slot selection open',
    description:
      'Sent when workers can pick their prayer slots for next month.',
    title: 'Prayer Selection Open',
    body: 'You can now select your prayer slots for the upcoming month.',
    url: '/prayer',
    placeholders: {},
  },
  [PushNotificationKey.PRAYER_REMINDER_TWO_DAYS]: {
    category: EmailCategory.PRAYER_REMINDER,
    label: 'Prayer reminder — 2 days before',
    description: 'Sent two days before a prayer meeting.',
    title: 'Prayer Meeting Reminder — 2 Days Away',
    body: 'Your prayer meeting is on {{meeting_date}} at {{start_time}}.',
    url: '/prayer',
    placeholders: { meeting_date: '2026-10-04', start_time: '06:00' },
  },
  [PushNotificationKey.PRAYER_REMINDER_TODAY]: {
    category: EmailCategory.PRAYER_REMINDER,
    label: 'Prayer reminder — on the day',
    description: 'Sent on the morning of a prayer meeting.',
    title: 'Prayer Meeting Reminder — Today',
    body: 'Your prayer meeting is on {{meeting_date}} at {{start_time}}.',
    url: '/prayer',
    placeholders: { meeting_date: '2026-10-04', start_time: '06:00' },
  },
  [PushNotificationKey.SUNDAY_SCHOOL_QUESTION_ASKED]: {
    category: EmailCategory.SUNDAY_SCHOOL_QA,
    label: 'Sunday School question asked',
    description: "Sent to a class's teacher when a student asks a question.",
    title: 'New Sunday School Question',
    body: '{{asker_name}} asked a question in {{class_name}}.',
    url: '/sunday-school',
    placeholders: { asker_name: 'Ada Obi', class_name: 'Youth Class' },
  },
  [PushNotificationKey.SUNDAY_SCHOOL_QUESTION_UNASSIGNED]: {
    category: EmailCategory.SUNDAY_SCHOOL_QA,
    label: 'Sunday School question — no teacher',
    description:
      'Sent to Sunday School staff when a class without a teacher gets a question.',
    title: 'New Sunday School Question',
    body: '{{asker_name}} asked a question in {{class_name}} (no teacher assigned).',
    url: '/sunday-school',
    placeholders: { asker_name: 'Ada Obi', class_name: 'Youth Class' },
  },
  [PushNotificationKey.SUNDAY_SCHOOL_QUESTION_ANSWERED]: {
    category: EmailCategory.SUNDAY_SCHOOL_QA,
    label: 'Sunday School question answered',
    description: 'Sent to a student when their question gets an answer.',
    title: 'Your Question Was Answered',
    body: 'Your question in {{class_name}} has been answered.',
    url: '/sunday-school',
    placeholders: { class_name: 'Youth Class' },
  },
  [PushNotificationKey.SUNDAY_SCHOOL_CHECKIN_OPEN]: {
    category: EmailCategory.SUNDAY_SCHOOL_ATTENDANCE,
    label: 'Sunday School check-in open',
    description:
      'Sent to members of a class when check-in opens for their session.',
    title: 'Check-in is open',
    body: 'Check-in for {{class_name}} is open until {{closes_at}}. Tap to mark yourself present.',
    url: '/sunday-school',
    placeholders: { class_name: 'Youth Class', closes_at: '10:30' },
  },
  [PushNotificationKey.SUNDAY_SCHOOL_ABSENTEES]: {
    category: EmailCategory.SUNDAY_SCHOOL_ATTENDANCE,
    label: 'Sunday School members missing class',
    description:
      "Weekly note to a class's teacher and assistants listing how many members have missed several sessions in a row.",
    title: 'Members missing {{class_name}}',
    body: '{{count}} member(s) have missed {{misses}}+ sessions in a row. Tap to see who and reach out.',
    url: '/sunday-school',
    placeholders: { class_name: 'Youth Class', count: '3', misses: '3' },
  },
  [PushNotificationKey.CLASS_JOIN_APPROVED]: {
    category: EmailCategory.TRAINING_CLASSES,
    label: 'Training class request approved',
    description:
      'Sent to a member when their request to join a class is approved.',
    title: "You're in!",
    body: 'Your request to join {{class_name}} was approved. Tap to see the schedule.',
    url: '/classes',
    placeholders: { class_name: "Believers' Class" },
  },
  [PushNotificationKey.CLASS_JOIN_DECLINED]: {
    category: EmailCategory.TRAINING_CLASSES,
    label: 'Training class request declined',
    description:
      "Sent to a member when their request to join a class isn't approved.",
    title: 'About your class request',
    body: "Your request to join {{class_name}} wasn't approved this time. Tap for details.",
    url: '/classes',
    placeholders: { class_name: "Believers' Class" },
  },
  [PushNotificationKey.CLASS_CERTIFICATE_READY]: {
    category: EmailCategory.TRAINING_CLASSES,
    label: 'Training certificate ready',
    description:
      'Sent to a member when their certificate for a completed class is issued.',
    title: 'Your certificate is ready',
    body: 'Congratulations on completing {{class_name}}! Tap to download your certificate.',
    url: '/classes',
    placeholders: { class_name: "Believers' Class" },
  },
  [PushNotificationKey.PASTOR_FEEDBACK_REMINDER]: {
    category: EmailCategory.PASTOR_FEEDBACK,
    label: 'Weekly feedback reminder',
    description:
      "Reminds a department lead to submit the week's pastor feedback.",
    title: 'Weekly Feedback Reminder',
    body: "Don't forget to submit {{department_name}}'s feedback for the week of {{week_of}}.",
    url: '/pastor-feedback',
    placeholders: { department_name: 'Media', week_of: '2026-09-28' },
  },
  [PushNotificationKey.PASTOR_FEEDBACK_RESPONSE]: {
    category: EmailCategory.PASTOR_FEEDBACK,
    label: 'Pastor responded to feedback',
    description:
      'Sent to the submitter when a pastor responds to their feedback.',
    title: 'Pastor Response',
    body: 'A pastor responded to your {{department_name}} feedback for the week of {{week_of}}.',
    url: '/pastor-feedback',
    placeholders: { department_name: 'Media', week_of: '2026-09-28' },
  },
  [PushNotificationKey.SERVICE_SLOT_ASSIGNED]: {
    category: EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
    label: 'Added to a service programme',
    description: 'Sent when someone is given a slot in a service programme.',
    title: "You've Been Added to the Programme: {{service_name}}",
    body: '{{slot_type}} — {{service_name}}{{when}}',
    url: '/events',
    placeholders: {
      service_name: 'Sunday Service',
      slot_type: 'Scripture Reading',
      when: ' on 2026-10-04 at 09:00',
    },
  },
  [PushNotificationKey.SERVICE_SLOT_BACKUP]: {
    category: EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
    label: 'Named as a programme backup',
    description: 'Sent when someone is made the backup for a programme slot.',
    title: "You're the Backup for: {{service_name}}",
    body: '{{slot_type}} — {{service_name}}{{when}}',
    url: '/events',
    placeholders: {
      service_name: 'Sunday Service',
      slot_type: 'Scripture Reading',
      when: ' on 2026-10-04 at 09:00',
    },
  },
  [PushNotificationKey.SERVICE_SLOT_TEAM_ASSIGNED]: {
    category: EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
    label: 'Department on the programme',
    description:
      'Sent to every member of a department when the department is given a part of the service programme.',
    title: '{{department_name}} is on the programme',
    body: '{{slot_type}} — {{service_name}}{{when}}.',
    url: '/events',
    placeholders: {
      department_name: 'Choir',
      slot_type: 'Praise & Worship',
      service_name: 'Sunday Service',
      when: ' on Sunday, 12 October 2026 at 09:00 AM',
    },
  },
  [PushNotificationKey.SERVICE_SLOT_REMINDER]: {
    category: EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
    label: 'Programme reminder',
    description:
      'Sent the day before to whoever has a part in the service programme (every member, for a department).',
    title: 'Tomorrow: {{slot_type}}',
    body: "You're on the programme for {{service_name}}{{team_suffix}}.",
    url: '/events',
    placeholders: {
      slot_type: 'Praise & Worship',
      service_name: 'Sunday Service',
      team_suffix: ' with Choir',
    },
  },

  [PushNotificationKey.SERVICE_REMINDER]: {
    category: EmailCategory.EVENT_REMINDER,
    label: 'Service reminder',
    description:
      "Sent before each service to the people it's for: at the hours in Reminder Settings (Service Reminders), or at a service's own reminders when it has any.",
    title: 'Service Reminder: {{service_name}}',
    body: '{{service_name}} begins in {{time_until}}. Please make your way and check in on time.',
    url: '/events',
    placeholders: { service_name: 'Sunday Service', time_until: '1 hour' },
  },
  [PushNotificationKey.GOAL_CHANGES_REQUESTED]: {
    category: EmailCategory.DEPARTMENT_GOAL_ACTIVITY,
    label: 'Department goals — changes requested',
    description: 'Sent to department leads when an approver asks for changes.',
    title: 'Level {{level}} requested changes',
    body: '{{comment}}',
    url: '/department-goals',
    placeholders: {
      level: '1',
      comment: 'Please add a budget for the outreach.',
    },
  },
  [PushNotificationKey.GOAL_LEVEL_APPROVED]: {
    category: EmailCategory.DEPARTMENT_GOAL_ACTIVITY,
    label: 'Department goals — level approved',
    description: 'Sent to department leads when one approval level signs off.',
    title: 'Level {{level}} approved — awaiting Level {{next_level}}',
    body: '{{comment}}',
    url: '/department-goals',
    placeholders: { level: '1', next_level: '2', comment: 'Looks good.' },
  },
  [PushNotificationKey.GOAL_FULLY_APPROVED]: {
    category: EmailCategory.DEPARTMENT_GOAL_ACTIVITY,
    label: 'Department goals — fully approved',
    description:
      'Sent to department leads when their goals are fully approved.',
    title: 'Your department goals have been fully approved',
    body: '{{comment}}',
    url: '/department-goals',
    placeholders: { comment: 'Well done, team.' },
  },
  [PushNotificationKey.GOAL_NEW_COMMENT]: {
    category: EmailCategory.DEPARTMENT_GOAL_ACTIVITY,
    label: 'Department goals — new comment',
    description:
      'Sent to department leads when someone comments on their goals.',
    title: "New comment on your department's goals",
    body: '{{comment}}',
    url: '/department-goals',
    placeholders: { comment: 'Can we move the retreat to November?' },
  },
  [PushNotificationKey.OUTREACH_TEAM_ADDED]: {
    category: EmailCategory.EVANGELISM,
    label: 'Added to an outreach team',
    description: 'Sent to a worker when someone adds them to an outreach team.',
    title: 'You were added to an outreach team',
    body: '{{creator_name}} added you to the team for {{outreach_label}}.',
    url: '/evangelism',
    placeholders: {
      creator_name: 'Ada Obi',
      outreach_label: 'Market outreach (12 Oct)',
    },
  },
  [PushNotificationKey.CONVERT_ASSIGNED]: {
    category: EmailCategory.EVANGELISM,
    label: 'Convert assigned',
    description: 'Sent to a worker when a convert is assigned to them.',
    title: 'New convert to follow up',
    body: '{{convert_name}} has been assigned to you for follow-up.',
    url: '/evangelism',
    placeholders: { convert_name: 'John Smith' },
  },
  [PushNotificationKey.CONVERTS_BULK_ASSIGNED]: {
    category: EmailCategory.EVANGELISM,
    label: 'Converts reassigned in bulk',
    description:
      'Sent to a worker when an admin moves several converts to them at once.',
    title: 'New converts to follow up',
    body: '{{count}} converts have been assigned to you for follow-up.',
    url: '/evangelism',
    placeholders: { count: '5' },
  },
  [PushNotificationKey.CONVERT_VISITED_CHURCH]: {
    category: EmailCategory.EVANGELISM,
    label: 'Convert visited church',
    description:
      'Sent to the outreach team and assignee when Follow-Up confirms a convert came to church as a first-timer.',
    title: '{{convert_name}} visited church!',
    body: 'The Follow-Up team is now following them up.',
    url: '/evangelism',
    placeholders: { convert_name: 'John Smith' },
  },
  [PushNotificationKey.NOTE_EVENING_NUDGE]: {
    category: EmailCategory.NOTES,
    label: 'Notes after a service',
    description:
      "Sent the evening after a service to members who attended but haven't written notes for it.",
    title: 'Before you forget',
    body: 'What stood out to you at {{service_name}} today? Capture three things in your notes.',
    url: '/notes',
    placeholders: { service_name: 'Sunday Service' },
  },
  [PushNotificationKey.NOTE_COMMITMENT_REMINDER]: {
    category: EmailCategory.NOTES,
    label: 'Weekly step reminder',
    description:
      'Sent on Monday morning to members who wrote "One thing I\'ll do this week" in last week\'s notes.',
    title: 'Your step this week',
    body: 'You wrote: "{{commitment}}". How is it going?',
    url: '/notes',
    placeholders: { commitment: 'Call my mum every evening' },
  },
  [PushNotificationKey.BIBLE_DUEL_INVITE]: {
    category: EmailCategory.BIBLE_GAMES,
    label: 'Duel invite',
    description:
      'Sent when another member challenges someone to a Guess the Bible Character duel.',
    title: '{{player_name}} challenged you',
    body: 'Play Guess the Bible Character ({{level}}). Accept within {{hours}} hours.',
    url: '/games/characters/duels',
    placeholders: {
      player_name: 'Grace Adebayo',
      level: 'Medium',
      hours: '24',
    },
  },
  [PushNotificationKey.BIBLE_DUEL_YOUR_TURN]: {
    category: EmailCategory.BIBLE_GAMES,
    label: 'Duel: your turn',
    description:
      'Sent when the other player has moved in a Guess the Bible Character duel.',
    title: 'Your turn',
    body: "{{player_name}} has played. It's your move; you have {{hours}} hours.",
    url: '/games/characters/duels',
    placeholders: { player_name: 'Grace Adebayo', hours: '24' },
  },
  [PushNotificationKey.BIBLE_DUEL_FINISHED]: {
    category: EmailCategory.BIBLE_GAMES,
    label: 'Duel finished',
    description:
      'Sent to both players when a Guess the Bible Character duel ends.',
    title: 'Duel over',
    body: 'Your duel with {{player_name}}: {{outcome}}',
    url: '/games/characters/duels',
    placeholders: { player_name: 'Grace Adebayo', outcome: 'you won!' },
  },
  [PushNotificationKey.PRAYER_REQUEST_PRAYED_FOR]: {
    category: EmailCategory.PRAYER_REQUESTS,
    label: 'Prayer request prayed for',
    description:
      'Sent to a member when the prayer team marks their request as prayed for.',
    title: 'Your request was prayed for',
    body: 'The prayer team has prayed for your request. You are not alone.',
    url: '/prayer-requests',
    placeholders: {},
  },
  [PushNotificationKey.PRAYER_REQUEST_ANSWERED]: {
    category: EmailCategory.PRAYER_REQUESTS,
    label: 'Prayer request answered',
    description:
      'Sent to a member when their request is marked answered, inviting a testimony.',
    title: 'Praise God, your prayer was answered',
    body: 'Would you like to share what God has done? Tap to share a testimony.',
    url: '/prayer-requests',
    placeholders: {},
  },
  [PushNotificationKey.RENTAL_BOOKING_CONFIRMED]: {
    category: EmailCategory.FACILITY_RENTAL,
    label: 'Booking confirmed',
    description: 'Sent to the renter when a booking is confirmed.',
    title: 'Your booking is confirmed',
    body: '{{facility_name}} on {{booking_date}}, {{booking_time}}.',
    url: '/facility-rental',
    placeholders: {
      facility_name: 'Main Hall',
      booking_date: 'Sat 7 Nov',
      booking_time: '10:00 AM–4:00 PM',
    },
  },
  [PushNotificationKey.RENTAL_BOOKING_REJECTED]: {
    category: EmailCategory.FACILITY_RENTAL,
    label: 'Booking not approved',
    description: "Sent to the renter when a booking request isn't approved.",
    title: "Your booking wasn't approved",
    body: '{{facility_name}} on {{booking_date}}: {{reason}}',
    url: '/facility-rental',
    placeholders: {
      facility_name: 'Main Hall',
      booking_date: 'Sat 7 Nov',
      reason: 'The hall is closed for repairs that weekend.',
    },
  },
  [PushNotificationKey.RENTAL_PAYMENT_RECEIVED]: {
    category: EmailCategory.FACILITY_RENTAL,
    label: 'Rental payment received',
    description:
      "Sent to the renter when a booking's fee or caution is marked paid.",
    title: 'Payment received',
    body: '{{amount}} {{payment_label}} for {{facility_name}} on {{booking_date}}. Thank you.',
    url: '/facility-rental',
    placeholders: {
      amount: 'NGN 50,000.00',
      payment_label: 'booking fee',
      facility_name: 'Main Hall',
      booking_date: 'Sat 7 Nov',
    },
  },
  [PushNotificationKey.RENTAL_CAUTION_REFUNDED]: {
    category: EmailCategory.FACILITY_RENTAL,
    label: 'Caution deposit refunded',
    description:
      "Sent to the renter when a booking's caution deposit is refunded.",
    title: 'Caution deposit refunded',
    body: '{{amount}} for {{facility_name}} on {{booking_date}} has been refunded.',
    url: '/facility-rental',
    placeholders: {
      amount: 'NGN 20,000.00',
      facility_name: 'Main Hall',
      booking_date: 'Sat 7 Nov',
    },
  },
  [PushNotificationKey.RENTAL_BOOKING_REMINDER]: {
    category: EmailCategory.FACILITY_RENTAL,
    label: 'Booking tomorrow',
    description: 'Sent to the renter the day before a confirmed booking.',
    title: 'Your booking is coming up',
    body: '{{facility_name}}, {{booking_date}} at {{booking_time}}.',
    url: '/facility-rental',
    placeholders: {
      facility_name: 'Main Hall',
      booking_date: 'Sat 7 Nov',
      booking_time: '10:00 AM–4:00 PM',
    },
  },
  [PushNotificationKey.FELLOWSHIP_MEETING_REMINDER]: {
    category: EmailCategory.FELLOWSHIPS,
    label: 'Fellowship meeting reminder',
    description: "Sent to a fellowship's members before each meeting.",
    title: '{{group_name}} meets {{when}}',
    body: '{{time}}{{place}}',
    url: '/small-groups',
    placeholders: {
      group_name: 'Lekki Fellowship',
      when: 'today',
      time: '6:00 PM–8:00 PM',
      place: ' · 12 Admiralty Way',
    },
  },
  [PushNotificationKey.FELLOWSHIP_MEMBER_MISSING]: {
    category: EmailCategory.FELLOWSHIPS,
    label: 'Member missed 3 meetings',
    description:
      'Sent to a fellowship leader when a member has missed three meetings in a row.',
    title: '{{member_name}} has missed 3 meetings',
    body: "{{member_name}} hasn't been at {{group_name}} for the last three meetings. A call might help.",
    url: '/small-groups',
    placeholders: {
      member_name: 'Ada Obi',
      group_name: 'Lekki Fellowship',
    },
  },
};

export type PushVars = Record<string, string | number | null | undefined>;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

// Plain token replacement, never a template engine: church-edited wording (Phase 1) can't run code.
export function fillPlaceholders(text: string, vars: PushVars = {}): string {
  return text
    .replace(/{{\s*(\w+)\s*}}/g, (_, name: string) => String(vars[name] ?? ''))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function renderPush(
  template: Pick<PushTemplate, 'title' | 'body'>,
  vars?: PushVars,
): { title: string; body: string } {
  return {
    title: clip(fillPlaceholders(template.title, vars), PUSH_TITLE_MAX),
    body: clip(fillPlaceholders(template.body, vars), PUSH_BODY_MAX),
  };
}
