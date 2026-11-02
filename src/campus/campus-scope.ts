import { SetMetadata } from '@nestjs/common';
import { ClsService, ClsServiceManager } from 'nestjs-cls';
import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { AdminPermission } from '../admin/enum/admin-permission.enum';
import { AppClsStore } from '../tenant/interface/tenant-cls-store.interface';

// An admin who looks after particular campuses never gets these, whatever their role says:
// they reach the whole church's settings, money, logs or other admins.
export const CHURCH_WIDE_ONLY_PERMISSIONS: ReadonlySet<AdminPermission> =
  new Set([
    AdminPermission.ADMIN_READ,
    AdminPermission.ADMIN_WRITE,
    AdminPermission.AUDIT_READ,
    AdminPermission.EMAIL_LOGS_READ,
    AdminPermission.FINANCE_READ,
    AdminPermission.FINANCE_WRITE,
    AdminPermission.FINANCE_APPROVE,
    AdminPermission.FINANCE_RECONCILE,
    AdminPermission.FINANCE_REPORT,
    AdminPermission.TITHE_READ,
    AdminPermission.TITHE_WRITE,
    AdminPermission.COMMUNICATION_PROVIDERS_READ,
    AdminPermission.COMMUNICATION_PROVIDERS_WRITE,
    AdminPermission.YOUTUBE_INTEGRATION_READ,
    AdminPermission.YOUTUBE_INTEGRATION_WRITE,
    AdminPermission.CHURCH_PROFILE_WRITE,
    AdminPermission.BILLING_READ,
    AdminPermission.BILLING_WRITE,
    AdminPermission.BRANCH_READ,
    AdminPermission.BRANCH_WRITE,
    AdminPermission.SOCIAL_MEDIA_READ,
    AdminPermission.SOCIAL_MEDIA_WRITE,
    AdminPermission.PAGES_WRITE,
    AdminPermission.SMS_READ,
  ]);

export function effectivePermissions(
  permissions: AdminPermission[],
  campusScoped: boolean,
): AdminPermission[] {
  return campusScoped
    ? permissions.filter((p) => !CHURCH_WIDE_ONLY_PERMISSIONS.has(p))
    : permissions;
}

// Routes that hand out people's data in bulk (exports, imports) stay with church-wide admins.
export const CHURCH_WIDE_ONLY_KEY = 'churchWideOnly';
export const ChurchWideOnly = () => SetMetadata(CHURCH_WIDE_ONLY_KEY, true);

// The route param naming one member; a campus admin is refused when that member belongs to another campus.
export const SCOPED_MEMBER_PARAM_KEY = 'scopedMemberParam';
export const ScopedMember = (param = 'id') =>
  SetMetadata(SCOPED_MEMBER_PARAM_KEY, param);

// The campuses the current admin looks after; null for everyone else (church-wide admins, owners, members, jobs).
export function campusScopeOf(cls: ClsService<AppClsStore>): string[] | null {
  if (!cls.isActive()) return null;
  const scope = cls.get('campusScope');
  return scope?.length ? scope : null;
}

// The signed-in campus admin's campuses, read from the request without injecting anything.
export function currentCampusScope(): string[] | null {
  return campusScopeOf(ClsServiceManager.getClsService<AppClsStore>());
}

// Narrows a people list to the campus admin's own campuses (and people with none yet); no-op for everyone else.
export function scopeToCampuses<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  memberAlias: string,
): SelectQueryBuilder<T> {
  const scope = currentCampusScope();
  if (scope) {
    qb.andWhere(visibleMemberSql(memberAlias, 'campusScopeIds'), {
      campusScopeIds: scope,
    });
  }
  return qb;
}

// SQL for "this member is someone the admin may see in full": their own campuses, or no campus yet.
export function visibleMemberSql(alias: string, param = 'campusScope'): string {
  return `(${alias}.home_campus_id IS NULL OR ${alias}.home_campus_id = ANY(:${param}))`;
}

// What an admin of another campus may see of a person: who they are, nothing more.
const KEPT_KEYS = new Set([
  'id',
  'memberId',
  'member_id',
  'firstname',
  'lastname',
  'name',
  'fullName',
  'photoUrl',
  'photo_url',
  'role',
]);
const NAME_KEYS = ['firstname', 'lastname', 'name', 'fullName'];
const ID_KEYS = ['id', 'memberId', 'member_id'];

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  !!v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v);

// Any object with a name and an id might be a person; the members table decides which ones are.
const personKeys = (v: Json): string[] =>
  NAME_KEYS.some((k) => k in v)
    ? ID_KEYS.map((k) => v[k]).filter((x): x is string => typeof x === 'string')
    : [];

export function personIds(body: unknown, depth = 0, out = new Set<string>()) {
  if (depth > 12) return out;
  if (Array.isArray(body)) {
    for (const item of body) personIds(item, depth + 1, out);
  } else if (isObject(body)) {
    for (const id of personKeys(body)) out.add(id);
    for (const value of Object.values(body)) personIds(value, depth + 1, out);
  }
  return out;
}

// Trims each person outside the admin's campuses to name and photo, in place.
export function maskPeople(
  body: unknown,
  hidden: ReadonlySet<string>,
  depth = 0,
): void {
  if (depth > 12 || !hidden.size) return;
  if (Array.isArray(body)) {
    for (const item of body) maskPeople(item, hidden, depth + 1);
    return;
  }
  if (!isObject(body)) return;
  if (personKeys(body).some((id) => hidden.has(id))) {
    for (const key of Object.keys(body)) {
      if (!KEPT_KEYS.has(key)) delete body[key];
    }
    body.otherCampus = true;
    return;
  }
  for (const value of Object.values(body)) maskPeople(value, hidden, depth + 1);
}
