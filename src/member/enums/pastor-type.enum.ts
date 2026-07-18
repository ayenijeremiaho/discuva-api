export enum PastorTypeEnum {
  LEAD = 'LEAD',
  PARISH = 'PARISH',
  ASSOCIATE = 'ASSOCIATE',
}

export const PastorTypeLabels: Record<PastorTypeEnum, string> = {
  [PastorTypeEnum.LEAD]: 'Lead Pastor',
  [PastorTypeEnum.PARISH]: 'Parish Pastor',
  [PastorTypeEnum.ASSOCIATE]: 'Associate Pastor',
};
