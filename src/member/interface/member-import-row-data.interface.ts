export interface MemberImportRowData {
  firstname?: string;
  lastname?: string;
  email?: string;
  phoneNumber?: string;
  gender?: string;
  birthDay?: number | string;
  birthMonth?: number | string;
  birthYear?: number | string;
  maritalStatus?: string;
  yearBornAgain?: string;
  yearBaptized?: string;
  baptizedWithHolyGhost?: boolean | string;
  dateJoinedChurch?: string;
  // Bonus columns — when `department` is filled, the row is also promoted to a Worker.
  department?: string;
  profession?: string;
  yearJoinedWorkforce?: string;
}
