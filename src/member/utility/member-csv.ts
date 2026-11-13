import type { Member } from '../entity/member.entity';

type Column = [string, string, (member: Member) => unknown];
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
  ['id', 'Member ID', (m) => m.id],
  ['firstname', 'First Name', (m) => m.firstname],
  ['lastname', 'Last Name', (m) => m.lastname],
  ['email', 'Email', (m) => m.email],
  ['phoneNumber', 'Phone Number', (m) => m.phoneNumber],
  ['role', 'Role', (m) => label(m.role)],
  ['status', 'Member Status', (m) => label(m.status)],
  ['gender', 'Gender', (m) => label(m.gender)],
  ['birthDay', 'Birth Day', (m) => m.birthDay],
  ['birthMonth', 'Birth Month', (m) => m.birthMonth],
  ['birthYear', 'Birth Year', (m) => m.birthYear],
  ['maritalStatus', 'Marital Status', (m) => label(m.maritalStatus)],
  [
    'spouse',
    'Spouse',
    (m) => (m.spouse ? `${m.spouse.firstname} ${m.spouse.lastname}` : ''),
  ],
  ['address', 'Address', (m) => m.address],
  [
    'emergencyContactName',
    'Emergency Contact Name',
    (m) => m.emergencyContactName,
  ],
  [
    'emergencyContactPhone',
    'Emergency Contact Phone',
    (m) => m.emergencyContactPhone,
  ],
  [
    'emergencyContactRelationship',
    'Emergency Contact Relationship',
    (m) => m.emergencyContactRelationship,
  ],
  ['dateJoinedChurch', 'Date Joined Church', (m) => date(m.dateJoinedChurch)],
  ['yearBornAgain', 'Born Again Date', (m) => date(m.yearBornAgain)],
  ['yearBaptized', 'Baptism Date', (m) => date(m.yearBaptized)],
  [
    'baptizedWithHolyGhost',
    'Baptized With Holy Ghost',
    (m) => m.baptizedWithHolyGhost,
  ],
  ['clergyTitle', 'Clergy Title', (m) => m.clergy?.title?.name],
  [
    'serveInterestAt',
    'Interested In Serving Since',
    (m) => date(m.serveInterestAt),
  ],
  [
    'department',
    'Primary Department',
    (m) => m.workerProfile?.department?.name,
  ],
  [
    'secondaryDepartment',
    'Secondary Department',
    (m) => m.workerProfile?.secondaryDepartment?.name,
  ],
  ['workerStatus', 'Worker Status', (m) => label(m.workerProfile?.status)],
  ['isTrainee', 'Trainee', (m) => m.workerProfile?.isTrainee],
  ['profession', 'Profession', (m) => m.workerProfile?.profession],
  [
    'yearJoinedWorkforce',
    'Date Joined Workforce',
    (m) => date(m.workerProfile?.yearJoinedWorkforce),
  ],
  ['completedSOD', 'Completed SOD', (m) => m.workerProfile?.completedSOD],
  [
    'completedBibleCollege',
    'Completed Bible College',
    (m) => m.workerProfile?.completedBibleCollege,
  ],
  ['createdAt', 'Record Created Date', (m) => date(m.createdAt)],
];

const coreFields = [
  'id',
  'firstname',
  'lastname',
  'email',
  'phoneNumber',
  'role',
  'status',
];
const workerCoreFields = ['department', 'workerStatus'];
export const MEMBER_EXPORT_FIELD_KEYS = columns.map(([key]) => key);

export function memberExportFields(workers = false) {
  const required = new Set([
    ...coreFields,
    ...(workers ? workerCoreFields : []),
  ]);
  return columns.map(([key, label]) => ({
    key,
    label,
    required: required.has(key),
  }));
}

function selectedColumns(fields?: string[], workers = false): Column[] {
  if (fields === undefined) return columns;
  const selected = new Set([
    ...coreFields,
    ...(workers ? workerCoreFields : []),
    ...fields,
  ]);
  return columns.filter(([key]) => selected.has(key));
}

export function memberExportSelect(
  fields: string[],
  workers = false,
): string[] {
  const profile = workers ? 'profile' : 'workerProfile';
  const related: Record<string, string[]> = {
    spouse: ['spouse.id', 'spouse.firstname', 'spouse.lastname'],
    clergyTitle: ['clergy.id', 'clergyTitle.id', 'clergyTitle.name'],
    department: [`${profile}.id`, 'department.id', 'department.name'],
    secondaryDepartment: [
      `${profile}.id`,
      'secondaryDepartment.id',
      'secondaryDepartment.name',
    ],
    workerStatus: [`${profile}.id`, `${profile}.status`],
  };
  const workerFields = new Set([
    'isTrainee',
    'profession',
    'yearJoinedWorkforce',
    'completedSOD',
    'completedBibleCollege',
  ]);
  return [
    ...new Set(
      selectedColumns(fields, workers).flatMap(
        ([key]) =>
          related[key] ??
          (workerFields.has(key)
            ? [`${profile}.id`, `${profile}.${key}`]
            : [`member.${key}`]),
      ),
    ),
  ];
}

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

export const memberCsvHeader = (fields?: string[], workers = false): string =>
  selectedColumns(fields, workers)
    .map(([, name]) => csvCell(name))
    .join(',');
export const memberCsvRow = (
  member: Member,
  fields?: string[],
  workers = false,
): string =>
  selectedColumns(fields, workers)
    .map(([, , value]) => csvCell(value(member)))
    .join(',');
