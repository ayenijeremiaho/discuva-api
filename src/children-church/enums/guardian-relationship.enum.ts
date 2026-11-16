export enum GuardianRelationshipEnum {
  PARENT = 'PARENT',
  GUARDIAN = 'GUARDIAN',
  FATHER = 'FATHER',
  MOTHER = 'MOTHER',
  GRANDPARENT = 'GRANDPARENT',
  SIBLING = 'SIBLING',
  UNCLE = 'UNCLE',
  AUNT = 'AUNT',
  FAMILY_FRIEND = 'FAMILY_FRIEND',
  OTHER = 'OTHER',
}

export const GuardianRelationshipLabels: Record<
  GuardianRelationshipEnum,
  string
> = {
  [GuardianRelationshipEnum.PARENT]: 'Parent',
  [GuardianRelationshipEnum.GUARDIAN]: 'Guardian',
  [GuardianRelationshipEnum.FATHER]: 'Father',
  [GuardianRelationshipEnum.MOTHER]: 'Mother',
  [GuardianRelationshipEnum.GRANDPARENT]: 'Grandparent',
  [GuardianRelationshipEnum.SIBLING]: 'Sibling',
  [GuardianRelationshipEnum.UNCLE]: 'Uncle',
  [GuardianRelationshipEnum.AUNT]: 'Aunt',
  [GuardianRelationshipEnum.FAMILY_FRIEND]: 'Family Friend',
  [GuardianRelationshipEnum.OTHER]: 'Other',
};
