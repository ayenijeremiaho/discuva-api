import { ReminderSettingKey } from '../enum/reminder-setting-key.enum';

export interface KnownReminderSetting {
  label: string;
  unit: string;
  defaultThresholds: number[];
}

export const KNOWN_REMINDER_SETTINGS: Record<
  ReminderSettingKey,
  KnownReminderSetting
> = {
  [ReminderSettingKey.PLEDGE_REMINDER]: {
    label: 'Pledge Reminders',
    unit: 'days relative to due date',
    defaultThresholds: [7, 0, -3],
  },
  [ReminderSettingKey.BUDGET_ALERT]: {
    label: 'Budget Utilization Alerts',
    unit: '% of budget used',
    defaultThresholds: [80, 100],
  },
  [ReminderSettingKey.FOLLOW_UP_STALE]: {
    label: 'Follow-Up Staleness',
    unit: 'days since last activity',
    defaultThresholds: [7],
  },
  [ReminderSettingKey.ASSET_MAINTENANCE]: {
    label: 'Asset Maintenance Reminders',
    unit: 'days before due',
    defaultThresholds: [7, 3, 1, 0],
  },
  [ReminderSettingKey.ASSET_WARRANTY]: {
    label: 'Warranty Expiry Alerts',
    unit: 'days before expiry',
    defaultThresholds: [30, 14, 7, 1],
  },
  [ReminderSettingKey.VEHICLE_EXPIRY]: {
    label: 'Vehicle Document Expiry Alerts',
    unit: 'days before expiry',
    defaultThresholds: [30, 14, 7, 1],
  },
  [ReminderSettingKey.ASSIGNMENT_DUE]: {
    label: 'Assignment Due Reminders',
    unit: 'days before due',
    defaultThresholds: [3, 1, 0],
  },
  [ReminderSettingKey.CLASS_SESSION]: {
    label: 'Class Session Reminders',
    unit: 'hours before session',
    defaultThresholds: [24, 1],
  },
  [ReminderSettingKey.FELLOWSHIP_MEETING]: {
    label: 'Fellowship Meeting Reminders',
    unit: 'hours before meeting',
    defaultThresholds: [3],
  },
  [ReminderSettingKey.SERVICE_REMINDER]: {
    label: 'Service Reminders',
    unit: 'hours before the service',
    defaultThresholds: [24, 2],
  },
  [ReminderSettingKey.CHECKIN_NUDGE]: {
    label: 'Check-in Reminders',
    unit: "minutes before the late time (workers) or the start (members), to anyone who hasn't checked in",
    defaultThresholds: [15],
  },
  [ReminderSettingKey.TEAM_MEETING]: {
    label: 'Team Meeting Reminders',
    unit: "hours before a department or fellowship meeting, to everyone except those who said they can't come",
    defaultThresholds: [24, 1],
  },
  [ReminderSettingKey.ROTA_DUTY]: {
    label: 'Serving Rota Reminders',
    unit: 'hours before a service, to everyone on the rota for it',
    defaultThresholds: [24, 2],
  },
  [ReminderSettingKey.THANK_YOU]: {
    label: 'Thank You After Service',
    unit: 'minutes after the service ends, to everyone who checked in (0 sends it straight away)',
    defaultThresholds: [20],
  },
};
