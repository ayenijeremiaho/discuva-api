// Shared between the Events module (EventConfig.defaultFormat /
// ServiceSlot.formatOverride) and the Fellowships module
// (SmallGroup.meetingFormat) — lives in utility/ rather than either feature
// module so neither depends on the other. Deliberately two values only, no
// HYBRID: nothing in the check-in/attendance flow needs "both at once" yet,
// and adding a third value later is a small, additive change.
export enum MeetingFormatEnum {
  IN_PERSON = 'IN_PERSON',
  ONLINE = 'ONLINE',
}
