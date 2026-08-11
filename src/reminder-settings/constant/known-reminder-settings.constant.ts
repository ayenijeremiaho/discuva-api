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
};
