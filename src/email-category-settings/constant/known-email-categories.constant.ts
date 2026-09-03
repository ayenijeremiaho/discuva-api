import { EmailCategory } from '../../utility/email-provider/email-category.enum';

export interface KnownEmailCategory {
  label: string;
  description: string;
}

export const KNOWN_EMAIL_CATEGORIES: Record<EmailCategory, KnownEmailCategory> =
  {
    [EmailCategory.ATTENDANCE_CHECKIN]: {
      label: 'Attendance Check-in Confirmations',
      description: 'Sent to a member after checking in to a service.',
    },
    [EmailCategory.BIRTHDAY]: {
      label: 'Birthday Wishes',
      description: 'Sent to members on their birthday.',
    },
    [EmailCategory.EVENT_REMINDER]: {
      label: 'Event Reminders',
      description: 'Sent ahead of an upcoming service or event.',
    },
    [EmailCategory.PRAYER_REMINDER]: {
      label: 'Prayer Reminders',
      description: 'Sent to remind members of their prayer schedule slot.',
    },
    [EmailCategory.FOLLOW_UP]: {
      label: 'First-Timer Follow-Up',
      description: 'Sent as part of the new-visitor follow-up pipeline.',
    },
    [EmailCategory.ASSET_ALERTS]: {
      label: 'Asset Alerts',
      description:
        'Overdue checkouts, warranty and vehicle document expiry, maintenance reminders.',
    },
    [EmailCategory.GIVING_RECEIPT]: {
      label: 'Giving Receipts',
      description:
        'Sent to a member confirming a tithe, offering, or pledge payment.',
    },
    [EmailCategory.FINANCE_ALERTS]: {
      label: 'Finance Alerts',
      description:
        'Budget utilization and pledge-reminder alerts to finance staff.',
    },
    [EmailCategory.SESSION_REPORT]: {
      label: 'Service Session Reports',
      description:
        'Sent after a live service session ends, summarizing what happened.',
    },
    [EmailCategory.INCIDENT_REPORT]: {
      label: 'Incident Reports',
      description: 'Sent when an incident report is filed.',
    },
    [EmailCategory.CHILDREN_CHURCH]: {
      label: "Children's Church Notifications",
      description:
        "Check-in/pickup and related children's church notifications.",
    },
    [EmailCategory.LOGIN_ALERT]: {
      label: 'Login Alerts',
      description:
        'Sent the first time a member logs in from a new device — not on every login.',
    },
    [EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT]: {
      label: 'Service Programme Assignments',
      description:
        'Sent to a worker when assigned a slot in a service programme.',
    },
    [EmailCategory.PASTOR_FEEDBACK]: {
      label: 'Pastor Feedback',
      description: 'Weekly feedback requests and reminders to clergy/HODs.',
    },
    [EmailCategory.MEMBERSHIP_ANNIVERSARY]: {
      label: 'Membership Anniversary',
      description: 'Sent to members on their church membership anniversary.',
    },
    [EmailCategory.ASSIGNMENT_REMINDER]: {
      label: 'Assignment Due Reminders',
      description:
        'Sent to class enrollees (members and guests) ahead of an assignment due date, if they have not yet submitted.',
    },
    [EmailCategory.CLASS_SESSION_REMINDER]: {
      label: 'Class Session Reminders',
      description:
        "Sent to class enrollees (members and guests) ahead of a class's next scheduled session/meeting time.",
    },
    [EmailCategory.FORM_SUBMISSION]: {
      label: 'Form Submission Notifications',
      description:
        'Sent to admins with Forms access when a member or public submission comes in, for forms with this turned on.',
    },
  };
