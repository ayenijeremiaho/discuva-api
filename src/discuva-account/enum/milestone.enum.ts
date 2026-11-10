export enum MilestoneType {
  SALVATION = 'SALVATION',
  BAPTISM = 'BAPTISM',
  MEMBERSHIP_CLASS = 'MEMBERSHIP_CLASS',
  WORKERS_TRAINING = 'WORKERS_TRAINING',
  MARRIAGE = 'MARRIAGE',
  OTHER = 'OTHER',
}

export enum MilestoneSource {
  MEMBER = 'MEMBER',
  CHURCH = 'CHURCH',
}

export enum MilestoneVisibility {
  PRIVATE = 'PRIVATE',
  CHURCHES = 'CHURCHES',
}

// The class types a church can mark as counting towards a milestone.
export const CLASS_MILESTONE_TYPES = [
  MilestoneType.MEMBERSHIP_CLASS,
  MilestoneType.WORKERS_TRAINING,
] as const;
export type ClassMilestoneType = (typeof CLASS_MILESTONE_TYPES)[number];

export const MILESTONE_LABELS: Record<MilestoneType, string> = {
  [MilestoneType.SALVATION]: 'Gave my life to Christ',
  [MilestoneType.BAPTISM]: 'Baptism',
  [MilestoneType.MEMBERSHIP_CLASS]: 'Membership class',
  [MilestoneType.WORKERS_TRAINING]: "Workers' training",
  [MilestoneType.MARRIAGE]: 'Marriage',
  [MilestoneType.OTHER]: 'Other',
};
