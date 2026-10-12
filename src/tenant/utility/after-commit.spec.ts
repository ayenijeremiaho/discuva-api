import { afterCommit, flushAfterCommit } from './after-commit';

const clsWith = (store: Record<string, unknown>, active = true) =>
  ({
    isActive: () => active,
    get: (k: string) => store[k],
    set: (k: string, v: unknown) => {
      store[k] = v;
    },
  }) as never;

describe('afterCommit', () => {
  it('waits for the commit inside a tenant transaction, then runs in order', async () => {
    const store: Record<string, unknown> = { afterCommit: [] };
    const cls = clsWith(store);
    const ran: string[] = [];
    afterCommit(cls, () => ran.push('a'));
    afterCommit(cls, () => ran.push('b'));
    expect(ran).toEqual([]);
    await flushAfterCommit(cls);
    expect(ran).toEqual(['a', 'b']);
    expect(store.afterCommit).toEqual([]);
  });

  it('runs straight away outside a tenant transaction', async () => {
    const ran: string[] = [];
    afterCommit(clsWith({}, false), () => ran.push('x'));
    await Promise.resolve();
    expect(ran).toEqual(['x']);
  });

  it('keeps going when one task fails', async () => {
    const store: Record<string, unknown> = { afterCommit: [] };
    const cls = clsWith(store);
    const ran: string[] = [];
    afterCommit(cls, () => {
      throw new Error('boom');
    });
    afterCommit(cls, () => ran.push('after'));
    await flushAfterCommit(cls);
    expect(ran).toEqual(['after']);
  });
});
