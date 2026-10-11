import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { EventAudienceEnum } from '../enums/event-audience.enum';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';

export interface AudienceTarget {
  audience?: EventAudienceEnum | null;
  audienceGroupId?: string | null;
}

// A group audience whose group was deleted falls back to everyone.
export function effectiveAudience(target: AudienceTarget): EventAudienceEnum {
  const audience = target.audience ?? EventAudienceEnum.EVERYONE;
  return audience === EventAudienceEnum.GROUP && !target.audienceGroupId
    ? EventAudienceEnum.EVERYONE
    : audience;
}

// Narrows a member query to the people an event is for. `key` keeps params distinct when stacking (event + slot).
export function scopeToAudience<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  memberAlias: string,
  target: AudienceTarget,
  key = 'audience',
): SelectQueryBuilder<T> {
  const audience = effectiveAudience(target);
  if (audience === EventAudienceEnum.WORKERS) {
    qb.andWhere(`${memberAlias}.role = :${key}Role`, {
      [`${key}Role`]: MemberRoleEnum.WORKER,
    });
  } else if (audience === EventAudienceEnum.GROUP) {
    qb.andWhere(
      `EXISTS (SELECT 1 FROM group_members ${key}_gm WHERE ${key}_gm.member_id = ${memberAlias}.id AND ${key}_gm.group_id = :${key}GroupId)`,
      { [`${key}GroupId`]: target.audienceGroupId },
    );
  }
  return qb;
}

// Whether a viewer may attend a slot with its own audience; `groupIds` are the viewer's groups.
export function slotIsForViewer(
  slot: AudienceTarget,
  viewer: { isWorker: boolean; groupIds: ReadonlySet<string> },
): boolean {
  const audience = effectiveAudience(slot);
  if (audience === EventAudienceEnum.WORKERS) return viewer.isWorker;
  if (audience === EventAudienceEnum.GROUP)
    return viewer.groupIds.has(slot.audienceGroupId!);
  return true;
}

// SQL condition for "this event is for the viewer"; needs :viewerId and :viewerIsWorker.
export function eventVisibleToViewerSql(eventAlias: string): string {
  return `(${eventAlias}.audience = '${EventAudienceEnum.EVERYONE}'
    OR (${eventAlias}.audience = '${EventAudienceEnum.WORKERS}' AND :viewerIsWorker = true)
    OR (${eventAlias}.audience = '${EventAudienceEnum.GROUP}' AND (${eventAlias}.audience_group_id IS NULL
      OR EXISTS (SELECT 1 FROM group_members viewer_gm WHERE viewer_gm.group_id = ${eventAlias}.audience_group_id AND viewer_gm.member_id = :viewerId))))`;
}
