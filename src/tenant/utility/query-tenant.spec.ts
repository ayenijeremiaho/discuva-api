import { queryTenant } from './query-tenant';

describe('queryTenant', () => {
  const dataSource = { query: jest.fn().mockResolvedValue([{ id: 1 }]) };

  beforeEach(() => jest.clearAllMocks());

  it('runs the query against the quoted tenant schema', async () => {
    const rows = await queryTenant(
      dataSource as any,
      'church_demo',
      (s) => `SELECT id FROM ${s}.members WHERE id = $1`,
      ['m1'],
    );

    expect(dataSource.query).toHaveBeenCalledWith(
      'SELECT id FROM "church_demo".members WHERE id = $1',
      ['m1'],
    );
    expect(rows).toEqual([{ id: 1 }]);
  });

  it.each([undefined, '', 'Church-Demo', 'x"; DROP TABLE members; --'])(
    'returns nothing for a missing or unsafe schema (%p)',
    async (schema) => {
      await expect(
        queryTenant(dataSource as any, schema, (s) => `SELECT 1 FROM ${s}.t`),
      ).resolves.toEqual([]);
      expect(dataSource.query).not.toHaveBeenCalled();
    },
  );
});
