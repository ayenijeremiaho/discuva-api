// Whether two events may run at the same time.
export enum EventOverlapRule {
  ALLOW = 'ALLOW',
  // Only services for a group or workers may share a time, and only at different venues; one for everyone stands alone.
  GROUPS_AT_OTHER_VENUES = 'GROUPS_AT_OTHER_VENUES',
  BLOCK_ALL = 'BLOCK_ALL',
}
