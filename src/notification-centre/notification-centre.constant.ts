import { EmailCategory } from '../utility/email-provider/email-category.enum';
import { ReminderSettingKey } from '../reminder-settings/enum/reminder-setting-key.enum';

export const NOTIFICATION_GROUPS: Record<EmailCategory, string> = {
  [EmailCategory.ATTENDANCE_CHECKIN]: 'Services',
  [EmailCategory.EVENT_REMINDER]: 'Services',
  [EmailCategory.SESSION_REPORT]: 'Services',
  [EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT]: 'Services',
  [EmailCategory.INCIDENT_REPORT]: 'Services',
  [EmailCategory.BIRTHDAY]: 'People and care',
  [EmailCategory.MEMBERSHIP_ANNIVERSARY]: 'People and care',
  [EmailCategory.FOLLOW_UP]: 'People and care',
  [EmailCategory.PRAYER_REMINDER]: 'People and care',
  [EmailCategory.PRAYER_REQUESTS]: 'People and care',
  [EmailCategory.PASTOR_FEEDBACK]: 'People and care',
  [EmailCategory.EVANGELISM]: 'People and care',
  [EmailCategory.TEAM_SPACES]: 'Teams',
  [EmailCategory.COMMUNITY]: 'Teams',
  [EmailCategory.TEAM_PULSE]: 'Teams',
  [EmailCategory.SERVING_ROTA]: 'Teams',
  [EmailCategory.DEPARTMENT_GOAL_ACTIVITY]: 'Teams',
  [EmailCategory.FELLOWSHIPS]: 'Teams',
  [EmailCategory.ASSIGNMENT_REMINDER]: 'Learning and fun',
  [EmailCategory.CLASS_SESSION_REMINDER]: 'Learning and fun',
  [EmailCategory.SUNDAY_SCHOOL_QA]: 'Learning and fun',
  [EmailCategory.SUNDAY_SCHOOL_ATTENDANCE]: 'Learning and fun',
  [EmailCategory.TRAINING_CLASSES]: 'Learning and fun',
  [EmailCategory.CHILDREN_CHURCH]: 'Learning and fun',
  [EmailCategory.NOTES]: 'Learning and fun',
  [EmailCategory.BIBLE_GAMES]: 'Learning and fun',
  [EmailCategory.FINANCE_ALERTS]: 'Administration',
  [EmailCategory.ASSET_ALERTS]: 'Administration',
  [EmailCategory.FACILITY_RENTAL]: 'Administration',
  [EmailCategory.FORM_SUBMISSION]: 'Administration',
  [EmailCategory.GIVING_RECEIPT]: 'Essential',
  [EmailCategory.LOGIN_ALERT]: 'Essential',
};

// The only reminders that can also go by text.
export const SMS_REMINDER_KEYS: Partial<
  Record<EmailCategory, ReminderSettingKey>
> = {
  [EmailCategory.ASSIGNMENT_REMINDER]: ReminderSettingKey.ASSIGNMENT_DUE,
  [EmailCategory.CLASS_SESSION_REMINDER]: ReminderSettingKey.CLASS_SESSION,
};
