import {
  csvCell,
  memberCsvHeader,
  memberCsvRow,
  memberExportFields,
  memberExportSelect,
} from './member-csv';
import { Member } from '../entity/member.entity';

describe('member CSV', () => {
  it('keeps core columns and only adds chosen fields', () => {
    const header = memberCsvHeader([
      'emergencyContactName',
      'emergencyContactPhone',
    ]);
    expect(header).toContain(
      '"Member ID","First Name","Last Name","Email","Phone Number","Role","Member Status"',
    );
    expect(header).toContain(
      '"Emergency Contact Name","Emergency Contact Phone"',
    );
    expect(header).not.toContain('Birth Year');
    expect(header).not.toContain('Profession');
    expect(
      memberCsvRow({ id: 'm1', emergencyContactName: 'Ada' } as Member, [
        'emergencyContactName',
      ]),
    ).toContain('"Ada"');
  });

  it('always includes the worker department and status', () => {
    expect(memberCsvHeader([], true)).toContain(
      '"Primary Department","Worker Status"',
    );
    expect(
      memberExportFields(true)
        .filter((f) => f.required)
        .map((f) => f.key),
    ).toEqual([
      'id',
      'firstname',
      'lastname',
      'email',
      'phoneNumber',
      'role',
      'status',
      'department',
      'workerStatus',
    ]);
  });

  it('selects only chosen export data and required relation IDs', () => {
    const select = memberExportSelect(
      ['emergencyContactPhone', 'secondaryDepartment'],
      true,
    );
    expect(select).toEqual(
      expect.arrayContaining([
        'member.id',
        'member.email',
        'member.emergencyContactPhone',
        'profile.id',
        'profile.status',
        'department.name',
        'secondaryDepartment.name',
      ]),
    );
    expect(select).not.toContain('member.emergencyContactName');
    expect(select).not.toContain('member.birthYear');
    expect(select).not.toContain('profile.profession');
    expect(memberExportSelect(['password', 'deviceId'])).not.toContain(
      'member.password',
    );
    expect(memberExportSelect(['password', 'deviceId'])).not.toContain(
      'member.deviceId',
    );
  });

  it('quotes commas, newlines and quotes without losing Unicode', () => {
    expect(csvCell('Adé, "Hello"\nLagos')).toBe('"Adé, ""Hello""\nLagos"');
  });
  it.each(['=1+1', '+2348012345678', '-1+2', '@SUM(A1)', '  =1', '\tformula'])(
    'protects spreadsheet cell %s',
    (value) => {
      expect(csvCell(value)).toBe(`"'${value}"`);
    },
  );
  it('keeps unknown values empty and uses readable booleans', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(false)).toBe('"No"');
    expect(csvCell(true)).toBe('"Yes"');
  });
  it('exports profile details with separate birthday parts and no authentication data', () => {
    const member = {
      id: 'm1',
      firstname: 'Ada',
      lastname: 'Example',
      birthDay: 3,
      birthMonth: 5,
      birthYear: null,
      address: 'Somewhere',
      password: 'secret',
      deviceId: 'device',
      workerProfile: {
        department: { name: 'Music' },
        secondaryDepartment: { name: 'Media' },
        isTrainee: false,
      },
    } as Member;
    const header = memberCsvHeader();
    const row = memberCsvRow(member);
    expect(header).toContain('"Birth Day","Birth Month","Birth Year"');
    expect(row).toContain('"3","5",""');
    expect(row).toContain('"Music","Media"');
    expect(row).not.toMatch(/secret|device/);
    expect(header).not.toMatch(/password|device|token/i);
  });
});
