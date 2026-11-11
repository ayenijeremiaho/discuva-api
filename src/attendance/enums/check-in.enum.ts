export enum AttendanceStatusEnum {
  PRESENT = 'PRESENT',
  LATE = 'LATE',
  ABSENT = 'ABSENT',
  ON_LEAVE = 'ON_LEAVE',
  ATTENDED_ONLINE = 'ATTENDED_ONLINE',
  // Checked in as a visitor at another branch of the network: present for absence and follow-up, not in headcounts.
  ATTENDED_ELSEWHERE = 'ATTENDED_ELSEWHERE',
}

export const AttendanceStatusLabels: Record<AttendanceStatusEnum, string> = {
  [AttendanceStatusEnum.PRESENT]: 'Present',
  [AttendanceStatusEnum.LATE]: 'Late',
  [AttendanceStatusEnum.ABSENT]: 'Absent',
  [AttendanceStatusEnum.ON_LEAVE]: 'On Leave',
  [AttendanceStatusEnum.ATTENDED_ONLINE]: 'Attended Online',
  [AttendanceStatusEnum.ATTENDED_ELSEWHERE]: 'Attended at another branch',
};
