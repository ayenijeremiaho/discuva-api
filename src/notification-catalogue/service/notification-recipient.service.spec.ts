import { NotificationRecipientService } from './notification-recipient.service';

describe('NotificationRecipientService', () => {
  const qb = {
    leftJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawMany: jest.fn(),
  };
  const repo = { createQueryBuilder: jest.fn(() => qb) };
  const service = new NotificationRecipientService(repo as any);
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

  beforeEach(() => jest.clearAllMocks());

  it('finds a recipient by email, ignoring case', async () => {
    qb.getRawMany.mockResolvedValue([row]);

    const vars = await service.byEmail('ADA@example.com');

    expect(qb.where).toHaveBeenCalledWith('LOWER(m.email) = LOWER(:email)', {
      email: 'ADA@example.com',
    });
    expect(vars).toMatchObject({
      full_name: 'Ada Obi',
      phone: '',
      title: 'Ms',
      department: 'Media',
    });
  });

  it('returns no details for an address that is not a member', async () => {
    qb.getRawMany.mockResolvedValue([]);
    expect(await service.byEmail('guest@example.com')).toEqual({});
  });

  it('maps members by id and skips the query for an empty list', async () => {
    qb.getRawMany.mockResolvedValue([row]);

    const map = await service.byMemberIds(['m1']);

    expect(map.get('m1')?.last_name).toBe('Obi');
    expect(await service.byMemberIds([])).toEqual(new Map());
    expect(repo.createQueryBuilder).toHaveBeenCalledTimes(1);
  });
});
