export enum FirstTimerSourceEnum {
  WALK_IN = 'WALK_IN',
  ONLINE = 'ONLINE',
  REFERRAL = 'REFERRAL',
  SUNDAY_SCHOOL = 'SUNDAY_SCHOOL',
}

export enum FollowUpTaskTypeEnum {
  FIRST_TIMER = 'FIRST_TIMER',
  ONLINE_NO_RESPONSE = 'ONLINE_NO_RESPONSE',
  MANUAL = 'MANUAL',
}

export enum FollowUpTaskStatusEnum {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  UNREACHABLE = 'UNREACHABLE',
}

export enum FollowUpOutcomeEnum {
  JOINED = 'JOINED',
  DECLINED = 'DECLINED',
  NO_ANSWER = 'NO_ANSWER',
  PRAYED_WITH = 'PRAYED_WITH',
}

export enum ContactMethodEnum {
  PHONE_CALL = 'PHONE_CALL',
  WHATSAPP = 'WHATSAPP',
  IN_PERSON = 'IN_PERSON',
  SMS = 'SMS',
  EMAIL = 'EMAIL',
}
