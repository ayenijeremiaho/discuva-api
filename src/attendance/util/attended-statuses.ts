import { AttendanceStatusEnum } from '../enums/check-in.enum';

// Matches getAttendanceStreak's "genuinely attended" convention — ABSENT/ON_LEAVE
// rows (auto-marked, or an admin correction) don't count as a real check-in.
export const GENUINELY_ATTENDED_STATUSES = new Set([
  AttendanceStatusEnum.PRESENT,
  AttendanceStatusEnum.LATE,
  AttendanceStatusEnum.ATTENDED_ONLINE,
]);
