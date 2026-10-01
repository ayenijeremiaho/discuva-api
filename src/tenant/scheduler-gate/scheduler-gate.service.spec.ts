import { Logger } from '@nestjs/common';
import { SchedulerGateService } from './scheduler-gate.service';
import { memoryGateCache } from './scheduler-gate.testing';

const HOUR = 3_600_000;
const at = (iso: string) => new Date(iso);

describe('SchedulerGateService', () => {
  let cache: ReturnType<typeof memoryGateCache>;
  let tenantRepo: { find: jest.Mock };
  let cls: { get: jest.Mock; runWith: jest.Mock };
  let txHost: { tx: { query: jest.Mock }; withTransaction: jest.Mock };
  let gate: SchedulerGateService;
  const logger = { warn: jest.fn() } as unknown as Logger;

  beforeEach(() => {
    cache = memoryGateCache();
    tenantRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 't1', schemaName: 'church_a', subdomain: 'a' },
        { id: 't2', schemaName: 'church_b', subdomain: 'b' },
      ]),
    };
    cls = {
      get: jest.fn().mockReturnValue('t1'),
      runWith: jest.fn((_s: unknown, fn: () => unknown) => fn()),
    };
    txHost = {
      tx: { query: jest.fn() },
      withTransaction: jest.fn((fn: () => unknown) => fn()),
    };
    gate = new SchedulerGateService(
      cache as never,
      cls as never,
      tenantRepo as never,
    );
  });

  describe('shouldRun', () => {
    it('runs when nothing is recorded, or the due time has come', async () => {
      const now = at('2026-10-04T10:00:00Z');
      expect(await gate.shouldRun('event-reminders', 't1', now)).toBe(true);
      cache.store.set(
        'scheduler:next-due:event-reminders:t1',
        now.getTime() + 60_000,
      );
      expect(await gate.shouldRun('event-reminders', 't1', now)).toBe(false);
      expect(
        await gate.shouldRun(
          'event-reminders',
          't1',
          new Date(now.getTime() + 60_000),
        ),
      ).toBe(true);
    });

    it('runs if Redis is unavailable rather than risk skipping work', async () => {
      cache.getGlobal.mockRejectedValueOnce(new Error('redis down'));
      expect(await gate.shouldRun('event-reminders', 't1')).toBe(true);
    });
  });

  describe('sleepUntil', () => {
    const start = at('2026-10-04T10:05:00Z');
    const key = 'scheduler:next-due:rental-status:t1';

    it('sleeps until the next due time when it falls within the hour', async () => {
      await gate.sleepUntil(
        'rental-status',
        't1',
        at('2026-10-04T10:40:00Z'),
        start,
        start,
      );
      expect(cache.store.get(key)).toBe(at('2026-10-04T10:40:00Z').getTime());
    });

    it('never sleeps past the top of the next hour (safety net, and aligns every job to one wake-up)', async () => {
      await gate.sleepUntil(
        'rental-status',
        't1',
        at('2026-10-05T09:00:00Z'),
        start,
        start,
      );
      expect(cache.store.get(key)).toBe(at('2026-10-04T11:00:00Z').getTime());
      await gate.sleepUntil('rental-status', 't1', null, start, start);
      expect(cache.store.get(key)).toBe(at('2026-10-04T11:00:00Z').getTime());
    });

    it('stays on the normal cadence when work is already due', async () => {
      cache.store.set(key, 1);
      await gate.sleepUntil('rental-status', 't1', start, start, start);
      expect(cache.store.has(key)).toBe(false);
    });

    it("doesn't sleep through data that changed while the job was running", async () => {
      cache.store.set(
        'scheduler:woken:rental-status:t1',
        start.getTime() + 1000,
      );
      await gate.sleepUntil(
        'rental-status',
        't1',
        at('2026-10-04T10:40:00Z'),
        start,
        new Date(start.getTime() + 2000),
      );
      expect(cache.store.has(key)).toBe(false);
    });
  });

  describe('wake', () => {
    it("clears the current church's markers for the given jobs", async () => {
      cache.store.set('scheduler:next-due:event-reminders:t1', 9e15);
      cache.store.set('scheduler:next-due:event-reminders:t2', 9e15);
      await gate.wake(['event-reminders']);
      expect(cache.store.has('scheduler:next-due:event-reminders:t1')).toBe(
        false,
      );
      expect(cache.store.has('scheduler:next-due:event-reminders:t2')).toBe(
        true,
      );
      expect(cache.store.get('scheduler:woken:event-reminders:t1')).toEqual(
        expect.any(Number),
      );
    });

    it('does nothing outside a church context', async () => {
      cls.get.mockReturnValue(undefined);
      await gate.wake(['event-reminders']);
      expect(cache.setGlobal).not.toHaveBeenCalled();
    });
  });

  describe('activeTenants', () => {
    it('reads the database once and then serves the list from Redis', async () => {
      await gate.activeTenants();
      await new Promise((r) => setImmediate(r));
      const second = await gate.activeTenants();
      expect(tenantRepo.find).toHaveBeenCalledTimes(1);
      expect(second.map((t) => t.id)).toEqual(['t1', 't2']);
    });

    it('falls back to the database when Redis is unavailable', async () => {
      cache.getGlobal.mockRejectedValueOnce(new Error('redis down'));
      expect((await gate.activeTenants()).length).toBe(2);
    });
  });

  describe('forEachDueTenant', () => {
    it('runs each church with work due, and records when it is next needed', async () => {
      const fn = jest
        .fn()
        .mockResolvedValue(new Date(Date.now() + 10 * 60_000));
      const result = await gate.forEachDueTenant(
        'event-reminders',
        txHost as never,
        logger,
        fn,
      );
      expect(result).toEqual({ succeeded: 2, failed: 0, skipped: 0 });
      expect(txHost.tx.query).toHaveBeenCalledWith(
        'SET LOCAL search_path TO "church_a", public',
      );
      expect(cache.store.has('scheduler:next-due:event-reminders:t1')).toBe(
        true,
      );
    });

    it('a quiet tick touches no database at all: no tenant query, no transaction', async () => {
      await gate.activeTenants();
      await new Promise((r) => setImmediate(r));
      tenantRepo.find.mockClear();
      const later = Date.now() + 30 * 60_000;
      cache.store.set('scheduler:next-due:event-reminders:t1', later);
      cache.store.set('scheduler:next-due:event-reminders:t2', later);
      const fn = jest.fn();

      const result = await gate.forEachDueTenant(
        'event-reminders',
        txHost as never,
        logger,
        fn,
      );

      expect(result).toEqual({ succeeded: 0, failed: 0, skipped: 2 });
      expect(fn).not.toHaveBeenCalled();
      expect(tenantRepo.find).not.toHaveBeenCalled();
      expect(txHost.withTransaction).not.toHaveBeenCalled();
    });

    it("a failing church isn't put to sleep, so it's retried next tick, and the rest still run", async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue(null);
      const result = await gate.forEachDueTenant(
        'event-reminders',
        txHost as never,
        logger,
        fn,
      );
      expect(result).toEqual({ succeeded: 1, failed: 1, skipped: 0 });
      expect(cache.store.has('scheduler:next-due:event-reminders:t1')).toBe(
        false,
      );
      expect(cache.store.has('scheduler:next-due:event-reminders:t2')).toBe(
        true,
      );
    });
  });

  // The guarantee that matters: gating never changes *when* work happens. Simulate a tick-driven job over days of
  // random schedules, with and without the gate, and require identical results.
  describe('equivalence with ungated runs', () => {
    afterEach(() => jest.useRealTimers());

    const simulate = async (opts: {
      tickMinutes: number;
      days: number;
      dueTimes: number[];
      gated: boolean;
      // Extra items that appear mid-run (as if created by a user), with the time they're created.
      added?: { createdAt: number; due: number }[];
    }) => {
      jest.useFakeTimers({
        doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
      });
      const pending = new Map<number, number>(
        opts.dueTimes.map((d, i) => [i, d]),
      );
      const firedAt = new Map<number, number>();
      const added = [...(opts.added ?? [])].sort(
        (a, b) => a.createdAt - b.createdAt,
      );
      let nextId = opts.dueTimes.length;
      const job = async () => {
        const now = Date.now();
        for (const [id, due] of pending)
          if (due <= now) {
            firedAt.set(id, now);
            pending.delete(id);
          }
        const future = [...pending.values()].filter((d) => d > now);
        return future.length ? new Date(Math.min(...future)) : null;
      };
      const start = at('2026-10-04T00:00:00Z').getTime();
      for (
        let t = start;
        t <= start + opts.days * 24 * HOUR;
        t += opts.tickMinutes * 60_000
      ) {
        jest.setSystemTime(t);
        while (added.length && added[0].createdAt <= t) {
          const a = added.shift()!;
          pending.set(nextId++, a.due);
          if (opts.gated) await gate.wake(['event-reminders'], 't1');
        }
        if (opts.gated) {
          if (await gate.shouldRun('event-reminders', 't1')) {
            const started = new Date();
            const next = await job();
            await gate.sleepUntil('event-reminders', 't1', next, started);
          }
        } else {
          await job();
        }
      }
      return firedAt;
    };

    const randomTimes = (n: number, seed: number) => {
      let x = seed;
      const rand = () => (x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
      const start = at('2026-10-04T00:00:00Z').getTime();
      return Array.from(
        { length: n },
        () => start + Math.floor(rand() * 3 * 24 * HOUR),
      );
    };

    it.each([5, 10, 15, 60])(
      'fires everything at the same tick with %i-minute ticks',
      async (tick) => {
        const dueTimes = randomTimes(40, tick);
        const ungated = await simulate({
          tickMinutes: tick,
          days: 3,
          dueTimes,
          gated: false,
        });
        cache.store.clear();
        const gated = await simulate({
          tickMinutes: tick,
          days: 3,
          dueTimes,
          gated: true,
        });
        expect(gated).toEqual(ungated);
        expect(gated.size).toBe(40);
      },
    );

    it('picks up work created while the job was asleep at the same tick as before', async () => {
      const dueTimes = randomTimes(10, 7);
      const added = [
        {
          createdAt: at('2026-10-04T10:02:00Z').getTime(),
          due: at('2026-10-04T10:07:00Z').getTime(),
        },
        {
          createdAt: at('2026-10-05T23:59:00Z').getTime(),
          due: at('2026-10-06T00:01:00Z').getTime(),
        },
      ];
      const ungated = await simulate({
        tickMinutes: 15,
        days: 3,
        dueTimes,
        gated: false,
        added,
      });
      cache.store.clear();
      const gated = await simulate({
        tickMinutes: 15,
        days: 3,
        dueTimes,
        gated: true,
        added,
      });
      expect(gated).toEqual(ungated);
    });

    it('runs far less often on a quiet schedule (the point of the change)', async () => {
      jest.useFakeTimers({
        doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
      });
      const job = jest.fn().mockResolvedValue(null);
      const start = at('2026-10-04T00:00:00Z').getTime();
      let runs = 0;
      for (let t = start; t < start + 24 * HOUR; t += 5 * 60_000) {
        jest.setSystemTime(t);
        if (await gate.shouldRun('event-reminders', 't1')) {
          runs++;
          await gate.sleepUntil(
            'event-reminders',
            't1',
            await job(),
            new Date(),
          );
        }
      }
      // 288 five-minute ticks a day without the gate; with nothing scheduled, one per hour.
      expect(runs).toBe(24);
    });
  });
});
