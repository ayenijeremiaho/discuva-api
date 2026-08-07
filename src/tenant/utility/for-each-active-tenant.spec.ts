import { Logger } from '@nestjs/common';
import { forEachActiveTenant } from './for-each-active-tenant';

const mockTenantRepo = { find: jest.fn() };
const mockCls = {
  runWith: jest.fn((_store: unknown, fn: () => unknown) => fn()),
};
const mockTxHost = {
  tx: { query: jest.fn() },
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};
const logger = new Logger('test');

describe('forEachActiveTenant', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls fn once per active tenant, entering that tenant's own context each time", async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);
    const fn = jest.fn().mockResolvedValue(undefined);

    const result = await forEachActiveTenant(
      mockTenantRepo as any,
      mockCls as any,
      mockTxHost as any,
      logger,
      fn,
    );

    expect(mockTenantRepo.find).toHaveBeenCalledWith({
      where: { isActive: true },
    });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1', schemaName: 'church_a' }),
    );
    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't2', schemaName: 'church_b' }),
    );
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_a", public',
    );
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_b", public',
    );
    expect(result).toEqual({ succeeded: 2, failed: 0 });
  });

  it('continues past one tenant failing so the rest still get processed', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    const result = await forEachActiveTenant(
      mockTenantRepo as any,
      mockCls as any,
      mockTxHost as any,
      logger,
      fn,
    );

    expect(fn).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ succeeded: 1, failed: 1 });
  });

  it('does nothing and reports zero when there are no active tenants', async () => {
    mockTenantRepo.find.mockResolvedValue([]);
    const fn = jest.fn();

    const result = await forEachActiveTenant(
      mockTenantRepo as any,
      mockCls as any,
      mockTxHost as any,
      logger,
      fn,
    );

    expect(fn).not.toHaveBeenCalled();
    expect(result).toEqual({ succeeded: 0, failed: 0 });
  });
});
