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

// Narrows a member query to the people an event is for.
export function scopeToAudience<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  memberAlias: string,
  target: AudienceTarget,
): SelectQueryBuilder<T> {
  const audience = effectiveAudience(target);
  if (audience === EventAudienceEnum.WORKERS) {
    qb.andWhere(`${memberAlias}.role = :audienceRole`, {
      audienceRole: MemberRoleEnum.WORKER,
    });
  } else if (audience === EventAudienceEnum.GROUP) {
    qb.andWhere(
      `EXISTS (SELECT 1 FROM group_members audience_gm WHERE audience_gm.member_id = ${memberAlias}.id AND audience_gm.group_id = :audienceGroupId)`,
      { audienceGroupId: target.audienceGroupId },
    );
  }
  return qb;
}

// SQL condition for "this event is for the viewer"; needs :viewerId and :viewerIsWorker.
export function eventVisibleToViewerSql(eventAlias: string): string {
  return `(${eventAlias}.audience = '${EventAudienceEnum.EVERYONE}'
    OR (${eventAlias}.audience = '${EventAudienceEnum.WORKERS}' AND :viewerIsWorker = true)
    OR (${eventAlias}.audience = '${EventAudienceEnum.GROUP}' AND (${eventAlias}.audience_group_id IS NULL
      OR EXISTS (SELECT 1 FROM group_members viewer_gm WHERE viewer_gm.group_id = ${eventAlias}.audience_group_id AND viewer_gm.member_id = :viewerId))))`;
}
