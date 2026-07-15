export enum ServiceSlotTypeEnum {
  SPEAKER = 'SPEAKER',
  WORSHIP = 'WORSHIP',
  PRAYER = 'PRAYER',
  OFFERING = 'OFFERING',
  ANNOUNCEMENT = 'ANNOUNCEMENT',
  DEDICATION = 'DEDICATION',
  OTHER = 'OTHER',
  BREAK = 'BREAK',
}

export const ServiceSlotTypeLabels: Record<ServiceSlotTypeEnum, string> = {
  [ServiceSlotTypeEnum.SPEAKER]: 'Speaker',
  [ServiceSlotTypeEnum.WORSHIP]: 'Praise & Worship',
  [ServiceSlotTypeEnum.PRAYER]: 'Prayer',
  [ServiceSlotTypeEnum.OFFERING]: 'Offering',
  [ServiceSlotTypeEnum.ANNOUNCEMENT]: 'Announcement',
  [ServiceSlotTypeEnum.DEDICATION]: 'Dedication',
  [ServiceSlotTypeEnum.OTHER]: 'Other',
  [ServiceSlotTypeEnum.BREAK]: 'Break',
};
