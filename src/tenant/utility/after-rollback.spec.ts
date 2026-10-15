import { afterRollback, flushAfterRollback } from './after-commit';

function makeCls(active: boolean) {
  const store: Record<string, unknown> = {
    tenantId: 't1',
    schemaName: 'church_one',
    afterRollback: [],
  };
  return {
    isActive: jest.fn().mockReturnValue(active),
    get: jest.fn((k: string) => store[k]),
    set: jest.fn((k: string, v: unknown) => {
      store[k] = v;
    }),
    runWith: jest.fn((_s: unknown, fn: () => unknown) => fn()),
  };
}

describe('afterRollback', () => {
  it('holds the task until the request has rolled back, then runs it in its own tenant transaction', async () => {
    const cls = makeCls(true);
    const query = jest.fn().mockResolvedValue(undefined);
    const txHost = {
      withTransaction: jest.fn((fn: () => unknown) => fn()),
      tx: { query },
    };
    const task = jest.fn().mockResolvedValue(undefined);

    afterRollback(cls as any, task);
    expect(task).not.toHaveBeenCalled();

    await flushAfterRollback(cls as any, txHost as any);

    expect(txHost.withTransaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_one", public',
    );
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('keeps going when one task fails', async () => {
    const cls = makeCls(true);
    const txHost = {
      withTransaction: jest.fn((fn: () => unknown) => fn()),
      tx: { query: jest.fn() },
    };
    const second = jest.fn();
    afterRollback(cls as any, () => {
      throw new Error('boom');
    });
    afterRollback(cls as any, second);

    await flushAfterRollback(cls as any, txHost as any);
    expect(second).toHaveBeenCalled();
  });

  it('runs straight away outside a tenant transaction', async () => {
    const task = jest.fn();
    afterRollback(makeCls(false) as any, task);
    await Promise.resolve();
    expect(task).toHaveBeenCalled();
  });
});
