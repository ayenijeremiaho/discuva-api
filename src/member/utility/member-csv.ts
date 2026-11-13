import { Member } from '../entity/member.entity';

type Column = [string, (member: Member) => unknown];
const date = (value: unknown): string =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value ?? '').slice(0, 10);
const label = (value: string | null | undefined): string =>
  value
    ? value
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : '';
const columns: Column[] = [
  ['Member ID', (m) => m.id],
  ['First Name', (m) => m.firstname],
  ['Last Name', (m) => m.lastname],
  ['Email', (m) => m.email],
  ['Phone Number', (m) => m.phoneNumber],
  ['Role', (m) => label(m.role)],
  ['Member Status', (m) => label(m.status)],
  ['Gender', (m) => label(m.gender)],
  ['Birth Day', (m) => m.birthDay],
  ['Birth Month', (m) => m.birthMonth],
  ['Birth Year', (m) => m.birthYear],
  ['Marital Status', (m) => label(m.maritalStatus)],
  [
    'Spouse',
    (m) => (m.spouse ? `${m.spouse.firstname} ${m.spouse.lastname}` : ''),
  ],
  ['Address', (m) => m.address],
  ['Emergency Contact Name', (m) => m.emergencyContactName],
  ['Emergency Contact Phone', (m) => m.emergencyContactPhone],
  ['Emergency Contact Relationship', (m) => m.emergencyContactRelationship],
  ['Date Joined Church', (m) => date(m.dateJoinedChurch)],
  ['Born Again Date', (m) => date(m.yearBornAgain)],
  ['Baptism Date', (m) => date(m.yearBaptized)],
  ['Baptized With Holy Ghost', (m) => m.baptizedWithHolyGhost],
  ['Clergy Title', (m) => m.clergy?.title?.name],
  ['Interested In Serving Since', (m) => date(m.serveInterestAt)],
  ['Primary Department', (m) => m.workerProfile?.department?.name],
  ['Secondary Department', (m) => m.workerProfile?.secondaryDepartment?.name],
  ['Worker Status', (m) => label(m.workerProfile?.status)],
  ['Trainee', (m) => m.workerProfile?.isTrainee],
  ['Profession', (m) => m.workerProfile?.profession],
  ['Date Joined Workforce', (m) => date(m.workerProfile?.yearJoinedWorkforce)],
  ['Completed SOD', (m) => m.workerProfile?.completedSOD],
  ['Completed Bible College', (m) => m.workerProfile?.completedBibleCollege],
  ['Record Created Date', (m) => date(m.createdAt)],
];

export const MEMBER_EXPORT_SELECT = [
  ...[
    'id',
    'firstname',
    'lastname',
    'email',
    'phoneNumber',
    'role',
    'status',
    'gender',
    'birthDay',
    'birthMonth',
    'birthYear',
    'maritalStatus',
    'address',
    'emergencyContactName',
    'emergencyContactPhone',
    'emergencyContactRelationship',
    'dateJoinedChurch',
    'yearBornAgain',
    'yearBaptized',
    'baptizedWithHolyGhost',
    'serveInterestAt',
    'createdAt',
  ].map((field) => `member.${field}`),
  'spouse.id',
  'spouse.firstname',
  'spouse.lastname',
  'clergy.id',
  'clergyTitle.id',
  'clergyTitle.name',
];

export function csvCell(value: unknown): string {
  let text =
    value == null
      ? ''
      : typeof value === 'boolean'
        ? value
          ? 'Yes'
          : 'No'
        : String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))
    text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

export const memberCsvHeader = (): string =>
  columns.map(([name]) => csvCell(name)).join(',');
export const memberCsvRow = (member: Member): string =>
  columns.map(([, value]) => csvCell(value(member))).join(',');
