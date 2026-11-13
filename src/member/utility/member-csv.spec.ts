import { csvCell, memberCsvHeader, memberCsvRow } from './member-csv';
import { Member } from '../entity/member.entity';

describe('member CSV', () => {
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
