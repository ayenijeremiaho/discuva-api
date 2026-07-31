// Each value names the action it unlocks, not the department that grants
// it — a department can hold more than one, and its name/label is entirely
// up to the church (e.g. a "Children & Youth Pastorate" department could
// hold both MANAGE_CHILDREN_CHURCH and MANAGE_SUNDAY_SCHOOL). Keep this list
// exactly matched to real gated features — a capability with no feature
// behind it is meaningless.
export enum DepartmentCapability {
  MANAGE_SUNDAY_SCHOOL = 'MANAGE_SUNDAY_SCHOOL',
  MANAGE_CHILDREN_CHURCH = 'MANAGE_CHILDREN_CHURCH',
  MANAGE_PRAYER_REQUESTS = 'MANAGE_PRAYER_REQUESTS',
  MANAGE_EVANGELISM_CONVERTS = 'MANAGE_EVANGELISM_CONVERTS',
  MANAGE_FOLLOW_UP = 'MANAGE_FOLLOW_UP',
  FRONT_DESK_OPERATIONS = 'FRONT_DESK_OPERATIONS',
}

export const DepartmentCapabilityLabels: Record<DepartmentCapability, string> =
  {
    [DepartmentCapability.MANAGE_SUNDAY_SCHOOL]: 'Sunday School Management',
    [DepartmentCapability.MANAGE_CHILDREN_CHURCH]:
      "Children's Church Management",
    [DepartmentCapability.MANAGE_PRAYER_REQUESTS]: 'Prayer Request Management',
    [DepartmentCapability.MANAGE_EVANGELISM_CONVERTS]:
      'Evangelism Convert Management',
    [DepartmentCapability.MANAGE_FOLLOW_UP]: 'Follow-Up Management',
    [DepartmentCapability.FRONT_DESK_OPERATIONS]:
      'Front Desk Operations (manual check-in, session reports)',
  };
