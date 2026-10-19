import { BadRequestException } from '@nestjs/common';
import { JourneyService, stepDone } from './journey.service';

describe('JourneyService', () => {
  const types = [
    {
      id: 'lead',
      name: 'Leadership',
      description: null,
      next_class_type_id: null,
      is_active: true,
    },
    {
      id: 'found',
      name: 'Foundation',
      description: 'The basics.',
      next_class_type_id: 'memb',
      is_active: true,
    },
    {
      id: 'memb',
      name: 'Membership',
      description: null,
      next_class_type_id: 'lead',
      is_active: true,
    },
  ];
  let stored: Record<string, unknown> | null;
  let enabled: Record<string, boolean>;
  let answers: ((sql: string, params: unknown[]) => unknown)[];
  const repo = {
    findOne: jest.fn(() => Promise.resolve(stored ? { value: stored } : null)),
    query: jest.fn((sql: string, params: unknown[]) => {
      if (sql.includes('FROM class_types ORDER BY'))
        return Promise.resolve(types);
      const next = answers.shift();
      return Promise.resolve(next ? next(sql, params) : []);
    }),
  };
  const cache = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(1),
    key: jest.fn().mockReturnValue('cache-key'),
  };
  const churchSettings = {
    isEnabled: jest.fn((k: string) => Promise.resolve(enabled[k] ?? true)),
  };
  const service = new JourneyService(
    repo as never,
    churchSettings as never,
    cache as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    stored = null;
    enabled = {};
    answers = [];
  });

  describe('steps', () => {
    it('follows the linked class chain by default', async () => {
      const keys = (await service.steps()).map((s) => s.key);
      expect(keys).toEqual([
        'VISIT',
        'WELCOMED',
        'MEMBER',
        'CLASS:found',
        'CLASS:memb',
        'CLASS:lead',
        'SERVING',
      ]);
    });

    it('uses the classes the church picked, in its order', async () => {
      stored = { classTypeIds: ['memb', 'found'], stuckAfterDays: 14 };
      const keys = (await service.steps()).map((s) => s.key);
      expect(keys).toEqual([
        'VISIT',
        'WELCOMED',
        'MEMBER',
        'CLASS:memb',
        'CLASS:found',
        'SERVING',
      ]);
    });

    it('leaves out welcome and classes when those modules are off', async () => {
      enabled = { follow_up: false, classes: false };
      expect((await service.steps()).map((s) => s.key)).toEqual([
        'VISIT',
        'MEMBER',
        'SERVING',
      ]);
    });

    it('stops at a loop in the class chain', async () => {
      const looped = types.map((t) =>
        t.id === 'lead' ? { ...t, next_class_type_id: 'found' } : t,
      );
      repo.query.mockImplementationOnce(() => Promise.resolve(looped));
      const keys = (await service.steps()).map((s) => s.key);
      expect(keys.filter((k) => k.startsWith('CLASS:'))).toHaveLength(3);
    });
  });

  describe('mine', () => {
    const me =
      (over: Record<string, unknown> = {}) =>
      () => [
        {
          created_at: new Date('2026-09-01'),
          serve_interest_at: null,
          visited_at: new Date('2026-08-20'),
          first_timer_id: 'ft1',
          task_status: 'COMPLETED',
          serving: false,
          enrollments: [],
          ...over,
        },
      ];
    const nextClasses = () => [
      {
        class_type_id: 'memb',
        id: 'c2',
        name: 'Membership — Autumn',
        start_date: '2026-11-08',
      },
    ];

    it('marks done steps and points to the first one left', async () => {
      answers = [
        me({
          enrollments: [
            {
              type: 'found',
              status: 'COMPLETED',
              class: 'Foundation',
              at: '2026-10-01',
            },
          ],
        }),
        nextClasses,
      ];
      const { steps, done, total } = await service.mine('m1');
      expect(steps.map((s) => s.status)).toEqual([
        'DONE',
        'DONE',
        'DONE',
        'DONE',
        'NEXT',
        'TODO',
        'TODO',
      ]);
      expect(steps[0].at).toEqual(new Date('2026-08-20'));
      expect(steps[4].action).toEqual(
        expect.objectContaining({
          kind: 'CLASS',
          classId: 'c2',
          className: 'Membership — Autumn',
        }),
      );
      expect({ done, total }).toEqual({ done: 4, total: 7 });
    });

    it('shows a class under way and a serve request waiting', async () => {
      answers = [
        me({
          task_status: 'PENDING',
          serve_interest_at: new Date(),
          enrollments: [
            {
              type: 'found',
              status: 'IN_PROGRESS',
              class: 'Foundation — Nov',
              at: null,
            },
          ],
        }),
        () => [],
      ];
      const { steps } = await service.mine('m1');
      expect(steps[1]).toEqual(
        expect.objectContaining({ status: 'IN_PROGRESS' }),
      );
      expect(steps[3]).toEqual(
        expect.objectContaining({
          status: 'IN_PROGRESS',
          note: "You're in Foundation — Nov.",
        }),
      );
      expect(steps[4]).toEqual(
        expect.objectContaining({
          status: 'NEXT',
          action: expect.objectContaining({ classId: null }),
        }),
      );
      expect(steps[6]).toEqual(
        expect.objectContaining({ status: 'IN_PROGRESS', action: null }),
      );
    });

    it('treats members who never registered as a first-timer as welcomed', async () => {
      answers = [
        me({ first_timer_id: null, task_status: null, visited_at: null }),
        () => [],
      ];
      const { steps } = await service.mine('m1');
      expect(steps[1].status).toBe('DONE');
      expect(steps[0].at).toEqual(new Date('2026-09-01'));
    });

    it('offers serving once nothing is under way', async () => {
      enabled = { classes: false };
      answers = [me()];
      const { steps } = await service.mine('m1');
      expect(steps.at(-1)).toEqual(
        expect.objectContaining({ status: 'NEXT', action: { kind: 'SERVE' } }),
      );
    });
  });

  it('builds the funnel with a percentage per step', async () => {
    answers = [
      () => [
        {
          total: 40,
          welcomed: 30,
          is_member: 20,
          serving: 4,
          classes: { found: 10 },
        },
      ],
    ];
    const { total, steps } = await service.funnel(
      new Date('2026-01-01'),
      new Date('2026-07-01'),
    );
    expect(total).toBe(40);
    expect(steps.map((s) => [s.key, s.reached, s.percent])).toEqual([
      ['VISIT', 40, 100],
      ['WELCOMED', 30, 75],
      ['MEMBER', 20, 50],
      ['CLASS:found', 10, 25],
      ['CLASS:memb', 0, 0],
      ['CLASS:lead', 0, 0],
      ['SERVING', 4, 10],
    ]);
  });

  it('rejects a backwards or very long range', async () => {
    await expect(
      service.funnel(new Date('2026-07-01'), new Date('2026-01-01')),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.funnel(new Date('2020-01-01'), new Date('2026-01-01')),
    ).rejects.toThrow(BadRequestException);
  });

  describe('stuck', () => {
    const now = new Date('2026-10-19T00:00:00Z');
    const from = new Date('2026-01-01');
    const to = new Date('2026-10-19');

    it('lists people between two classes, binding only the params it uses', async () => {
      let seen: { sql: string; params: unknown[] } | undefined;
      answers = [
        (sql, params) => {
          seen = { sql, params };
          return [
            {
              first_timer_id: null,
              member_id: 'm1',
              started_at: new Date('2026-09-19T00:00:00Z'),
              firstname: 'Ada',
              lastname: 'Obi',
              phone: '080',
              email: null,
              total: 12,
            },
          ];
        },
      ];
      const res = await service.stuck('CLASS:memb', from, to, 2, 5, now);
      expect(seen!.sql).toContain(
        '($5::text = ANY(classes_done)) AND NOT ($6::text = ANY(classes_done))',
      );
      expect(seen!.params).toEqual([
        from,
        to,
        ['found', 'memb', 'lead'],
        new Date('2026-09-28T00:00:00Z'),
        'found',
        'memb',
        5,
        5,
      ]);
      expect(res).toEqual(
        expect.objectContaining({
          total: 12,
          page: 2,
          limit: 5,
          people: [
            expect.objectContaining({ name: 'Ada Obi', daysSinceStart: 30 }),
          ],
        }),
      );
    });

    it('uses plain flags for steps that are not classes', async () => {
      let seen: { sql: string; params: unknown[] } | undefined;
      answers = [(sql, params) => ((seen = { sql, params }), [])];
      const res = await service.stuck('MEMBER', from, to, 1, 20, now);
      expect(seen!.sql).toContain('(welcomed) AND NOT (is_member)');
      expect(seen!.params).toHaveLength(6);
      expect(res.total).toBe(0);
    });

    it('rejects the first step and unknown steps', async () => {
      await expect(service.stuck('VISIT', from, to)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.stuck('CLASS:gone', from, to)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('saveSettings', () => {
    it('saves and clears the cached settings', async () => {
      answers = [
        () => [{ id: 'found' }],
        () => [],
        () => [{ id: 'found', name: 'Foundation' }],
      ];
      await service.saveSettings({
        classTypeIds: ['found'],
        stuckAfterDays: 14,
      });
      expect(repo.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (key)'),
        [
          'journey:settings',
          JSON.stringify({ classTypeIds: ['found'], stuckAfterDays: 14 }),
        ],
      );
      expect(cache.del).toHaveBeenCalledWith('journey:settings');
    });

    it('rejects classes that no longer exist', async () => {
      answers = [() => []];
      await expect(
        service.saveSettings({ classTypeIds: ['gone'], stuckAfterDays: 14 }),
      ).rejects.toThrow('One of those classes no longer exists.');
    });
  });

  it('reads cached settings without touching the database', async () => {
    cache.get.mockResolvedValueOnce({ classTypeIds: null, stuckAfterDays: 30 });
    expect(await service.settings()).toEqual({
      classTypeIds: null,
      stuckAfterDays: 30,
    });
    expect(repo.findOne).not.toHaveBeenCalled();
  });

  it('decides whether a row has finished a step', () => {
    const row = {
      welcomed: true,
      is_member: false,
      serving: false,
      classes_done: ['found'],
    };
    expect(stepDone('VISIT', row)).toBe(true);
    expect(stepDone('MEMBER', row)).toBe(false);
    expect(stepDone('CLASS:found', row)).toBe(true);
    expect(stepDone('CLASS:memb', row)).toBe(false);
  });
});
