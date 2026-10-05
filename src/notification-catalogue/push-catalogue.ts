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
      'Sent ahead of a service, at the times set in Event Reminders.',
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
