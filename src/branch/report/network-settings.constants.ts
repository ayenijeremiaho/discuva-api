// Principle 7: numbers are settings. The platform sets the safe range; each network picks within it.
export interface NetworkSettingsValues {
  attendanceDropPercent: number;
  attendanceWeeks: number;
  notContactedCount: number;
  notContactedDays: number;
  noServiceWeeks: number;
  unreachablePercent: number;
  minAdmins: number;
  visitSuggestVisits: number;
  visitSuggestWeeks: number;
}

export const NETWORK_SETTING_LIMITS: Record<
  keyof NetworkSettingsValues,
  { default: number; min: number; max: number; label: string }
> = {
  attendanceDropPercent: {
    default: 15,
    min: 5,
    max: 50,
    label: 'Attendance drop (%)',
  },
  attendanceWeeks: { default: 6, min: 3, max: 12, label: 'Weeks compared' },
  notContactedCount: {
    default: 5,
    min: 1,
    max: 50,
    label: 'First-timers not contacted',
  },
  notContactedDays: {
    default: 7,
    min: 3,
    max: 21,
    label: 'Days before follow-up is overdue',
  },
  noServiceWeeks: {
    default: 3,
    min: 2,
    max: 8,
    label: 'Weeks with no service recorded',
  },
  unreachablePercent: {
    default: 20,
    min: 5,
    max: 80,
    label: "Last month's first-timers unreachable (%)",
  },
  minAdmins: {
    default: 2,
    min: 1,
    max: 5,
    label: 'Fewest admins a branch should have',
  },
  visitSuggestVisits: {
    default: 4,
    min: 0,
    max: 20,
    label: 'Visits before suggesting a move (0 = never)',
  },
  visitSuggestWeeks: {
    default: 8,
    min: 2,
    max: 26,
    label: 'Weeks counted for that',
  },
};
