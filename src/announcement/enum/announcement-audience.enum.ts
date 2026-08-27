export enum AnnouncementAudienceEnum {
  ALL = 'ALL',
  WORKERS_ONLY = 'WORKERS_ONLY',
  MEMBERS_ONLY = 'MEMBERS_ONLY',
  DEPARTMENT = 'DEPARTMENT',
  INDIVIDUAL = 'INDIVIDUAL',
  GROUP = 'GROUP',
  CLASS = 'CLASS',
}

export const AnnouncementAudienceLabels: Record<
  AnnouncementAudienceEnum,
  string
> = {
  [AnnouncementAudienceEnum.ALL]: 'Everyone',
  [AnnouncementAudienceEnum.WORKERS_ONLY]: 'Workers Only',
  [AnnouncementAudienceEnum.MEMBERS_ONLY]: 'Members Only',
  [AnnouncementAudienceEnum.DEPARTMENT]: 'Department',
  [AnnouncementAudienceEnum.INDIVIDUAL]: 'Individual Member',
  [AnnouncementAudienceEnum.GROUP]: 'Group',
  [AnnouncementAudienceEnum.CLASS]: 'Class',
};
