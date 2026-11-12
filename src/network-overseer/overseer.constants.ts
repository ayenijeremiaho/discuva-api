import { AdminPermission as P } from '../admin/enum/admin-permission.enum';

export const NETWORK_OVERSEER_MAX = 5;
export const OVERSEER_PASS_SECONDS = 15 * 60;
export const OVERSEER_SURFACE = 'OVERSEER';
// The same page opened again within this window isn't logged twice.
export const OVERSEER_VIEW_LOG_SECONDS = 10 * 60;

// Private to the branch: prayer, pastoral care, message logs, its connected accounts and its bill.
const NEVER = new Set<P>([
  P.PRAYER_READ,
  P.PASTOR_FEEDBACK_READ,
  P.FOLLOW_UP_READ,
  P.EMAIL_LOGS_READ,
  P.SMS_READ,
  P.COMMUNICATION_PROVIDERS_READ,
  P.YOUTUBE_INTEGRATION_READ,
  P.SOCIAL_MEDIA_READ,
  P.BILLING_READ,
]);

// Only when the branch shares giving with the churches above it.
export const GIVING_READ = new Set<P>([
  P.TITHE_READ,
  P.FINANCE_READ,
  P.FINANCE_REPORT,
]);

const BASE = Object.values(P).filter(
  (p) => p.endsWith(':read') && !NEVER.has(p) && !GIVING_READ.has(p),
);

export function overseerPermissions(sharesGiving: boolean): P[] {
  return sharesGiving ? [...BASE, ...GIVING_READ] : [...BASE];
}

export const overseerKey = (id: string) => `network-overseer:${id}`;
export const overseerBranchKey = (tenantId: string) =>
  `overseer-branch:${tenantId}`;
