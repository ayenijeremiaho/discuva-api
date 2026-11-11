// PENDING: signed up but never signed in, so the email is unproven; it counts nowhere.
// TRANSFERRED: moved to another branch in the network; kept as history here, counts nowhere.
export enum MemberStatusEnum {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  PENDING = 'PENDING',
  TRANSFERRED = 'TRANSFERRED',
}

export const MemberStatusLabels: Record<MemberStatusEnum, string> = {
  [MemberStatusEnum.ACTIVE]: 'Active',
  [MemberStatusEnum.INACTIVE]: 'Inactive',
  [MemberStatusEnum.PENDING]: 'Not signed in yet',
  [MemberStatusEnum.TRANSFERRED]: 'Moved to another branch',
};

export const UNCOUNTED_MEMBER_STATUSES = [
  MemberStatusEnum.PENDING,
  MemberStatusEnum.TRANSFERRED,
];
