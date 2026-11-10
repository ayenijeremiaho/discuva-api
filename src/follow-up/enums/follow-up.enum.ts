export enum FirstTimerSourceEnum {
  WALK_IN = 'WALK_IN',
  ONLINE = 'ONLINE',
  REFERRAL = 'REFERRAL',
  SUNDAY_SCHOOL = 'SUNDAY_SCHOOL',
  APP_SIGNUP = 'APP_SIGNUP',
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
  // Where a first-timer stands when followed up a month on; the monthly report's recap counts these.
  STILL_ATTENDING = 'STILL_ATTENDING',
  TEMPORARILY_AWAY = 'TEMPORARILY_AWAY',
  RELOCATED = 'RELOCATED',
}

export enum FirstTimerFieldType {
  TEXT = 'TEXT',
  LONG_TEXT = 'LONG_TEXT',
  CHOICE = 'CHOICE',
  MULTI_CHOICE = 'MULTI_CHOICE',
  YES_NO = 'YES_NO',
  DATE = 'DATE',
  // Stored as 'MM-DD', for birthdays given without a year.
  DAY_MONTH = 'DAY_MONTH',
}

export const CHOICE_FIELD_TYPES = new Set([
  FirstTimerFieldType.CHOICE,
  FirstTimerFieldType.MULTI_CHOICE,
]);

export enum ContactMethodEnum {
  PHONE_CALL = 'PHONE_CALL',
  WHATSAPP = 'WHATSAPP',
  IN_PERSON = 'IN_PERSON',
  SMS = 'SMS',
  EMAIL = 'EMAIL',
}
