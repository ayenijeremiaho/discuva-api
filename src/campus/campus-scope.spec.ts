import { AdminPermission } from '../admin/enum/admin-permission.enum';
import { effectivePermissions, maskPeople, personIds } from './campus-scope';

describe('campus scope', () => {
  it('takes church-wide permissions away from campus admins only', () => {
    const role = [
      AdminPermission.MEMBERS_READ,
      AdminPermission.BILLING_WRITE,
      AdminPermission.ADMIN_WRITE,
      AdminPermission.TITHE_READ,
    ];
    expect(effectivePermissions(role, true)).toEqual([
      AdminPermission.MEMBERS_READ,
    ]);
    expect(effectivePermissions(role, false)).toEqual(role);
  });

  it('finds people however deeply a response nests them', () => {
    const body = {
      data: [
        { id: 'r1', amount: 5, member: { id: 'm1', firstname: 'A' } },
        { id: 'r2', workerProfile: { member: { id: 'm2', lastname: 'B' } } },
      ],
      meta: { id: 'x', title: 'not a person' },
    };
    expect([...personIds(body)]).toEqual(['m1', 'm2']);
  });

  it('trims another campus’s person to name and photo, leaving the rest', () => {
    const other = {
      id: 'm1',
      firstname: 'Ada',
      lastname: 'Obi',
      photoUrl: 'p.jpg',
      email: 'ada@x.test',
      phoneNumber: '+234',
      birthDay: 3,
      homeCampusId: 'c2',
    };
    const mine = { id: 'm2', firstname: 'Ben', email: 'ben@x.test' };
    const body = { data: [{ member: other }, { member: mine }] };
    maskPeople(body, new Set(['m1']));
    expect(other).toEqual({
      id: 'm1',
      firstname: 'Ada',
      lastname: 'Obi',
      photoUrl: 'p.jpg',
      otherCampus: true,
    });
    expect(mine.email).toBe('ben@x.test');
  });

  it('also trims people shaped as name and member id rows', () => {
    const row = { memberId: 'm1', name: 'Ada Obi', email: 'a@x.test' };
    const dept = { id: 'd1', name: 'Choir', description: 'Sings' };
    const body = { recent: [row], departments: [dept] };
    expect([...personIds(body)]).toEqual(['m1', 'd1']);
    maskPeople(body, new Set(['m1']));
    expect(row).toEqual({ memberId: 'm1', name: 'Ada Obi', otherCampus: true });
    expect(dept.description).toBe('Sings');
  });

  it('leaves dates and plain values alone', () => {
    const at = new Date();
    const body = { at, n: 1, list: ['a'] };
    maskPeople(body, new Set(['a']));
    expect(body).toEqual({ at, n: 1, list: ['a'] });
  });
});
