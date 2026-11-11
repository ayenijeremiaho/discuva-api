// What one branch's month holds. Counts of people unless named otherwise.
export interface BranchMetrics {
  members: number;
  newMembers: number;
  firstTimers: number;
  // First-timers from this month who came back a second time, and a third.
  returnedTwice: number;
  returnedThrice: number;
  // Members who attended in the 8 weeks before, but not in the last 4 (or 8) weeks; as of the last recalculation.
  stoppedFourWeeks: number;
  stoppedEightWeeks: number;
  transfersIn: number;
  transfersOut: number;
  visitorsIn: number;
  visitsOut: number;
  services: number;
  // Check-ins (in person) and online confirmations across the month's services.
  attendance: number;
  online: number;
  ratingCount: number;
  // Average 1–5, null with no ratings.
  ratingAverage: number | null;
  milestones: number;
  classCompletions: number;
  // First-timers this month contacted (a note on their follow-up) within 7 days of their visit.
  contactedInWeek: number;
  // Only for branches that share giving with the churches above them; null otherwise.
  giving: number | null;
}

export type AttentionKind =
  | 'ATTENDANCE_DROP'
  | 'FIRST_TIMERS_NOT_CONTACTED'
  | 'NO_SERVICE'
  | 'FIRST_TIMERS_UNREACHABLE'
  | 'FEW_ADMINS';

export interface BranchAttention {
  kind: AttentionKind;
  // Plain sentence, e.g. "Attendance is down 22% on the 6 weeks before."
  detail: string;
}

// Counts of people from 1 to 4 are never shown in oversight views.
export const LOW_COUNT_KEYS: (keyof BranchMetrics)[] = [
  'newMembers',
  'firstTimers',
  'returnedTwice',
  'returnedThrice',
  'stoppedFourWeeks',
  'stoppedEightWeeks',
  'transfersIn',
  'transfersOut',
  'visitorsIn',
  'visitsOut',
  'milestones',
  'classCompletions',
  'contactedInWeek',
];
