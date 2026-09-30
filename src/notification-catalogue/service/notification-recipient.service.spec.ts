import { NotificationRecipientService } from './notification-recipient.service';

describe('NotificationRecipientService', () => {
  const dataSource = { query: jest.fn() };
  const cls = { get: jest.fn() };
  const service = new NotificationRecipientService(
    dataSource as any,
    cls as any,
  );
  const row = {
    id: 'm1',
    firstname: 'Ada',
    lastname: 'Obi',
    email: 'ada@example.com',
    phoneNumber: null,
    gender: 'FEMALE',
    maritalStatus: null,
    department: 'Media',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    cls.get.mockReturnValue('church_demo');
  });

  it("finds a recipient by email in the church's own schema, ignoring case", async () => {
    dataSource.query.mockResolvedValue([row]);

    const vars = await service.byEmail('ADA@example.com');

    const [sql, params] = dataSource.query.mock.calls[0];
    expect(sql).toContain('FROM "church_demo".members m');
    expect(sql).toContain('LOWER(m.email) = LOWER($1)');
    expect(params).toEqual(['ADA@example.com']);
    expect(vars).toMatchObject({
      full_name: 'Ada Obi',
      phone: '',
      title: 'Ms',
      department: 'Media',
    });
  });

  it('returns no details for an address that is not a member', async () => {
    dataSource.query.mockResolvedValue([]);
    expect(await service.byEmail('guest@example.com')).toEqual({});
  });

  it('maps members by id and skips the query for an empty list', async () => {
    dataSource.query.mockResolvedValue([row]);

    const map = await service.byMemberIds(['m1']);

    expect(map.get('m1')?.last_name).toBe('Obi');
    expect(dataSource.query.mock.calls[0][1]).toEqual([['m1']]);
    expect(await service.byMemberIds([])).toEqual(new Map());
    expect(dataSource.query).toHaveBeenCalledTimes(1);
  });

  it('looks nothing up without a church context', async () => {
    cls.get.mockReturnValue(undefined);
    expect(await service.byEmail('ada@example.com')).toEqual({});
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});
