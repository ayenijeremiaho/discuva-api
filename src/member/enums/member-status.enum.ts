// PENDING: signed up but never signed in, so the email is unproven; it counts nowhere.
export enum MemberStatusEnum {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  PENDING = 'PENDING',
}

export const MemberStatusLabels: Record<MemberStatusEnum, string> = {
  [MemberStatusEnum.ACTIVE]: 'Active',
  [MemberStatusEnum.INACTIVE]: 'Inactive',
  [MemberStatusEnum.PENDING]: 'Not signed in yet',
};
