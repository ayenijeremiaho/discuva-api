import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  TeamPulseService,
  nextOpening,
  roundScore,
} from './team-pulse.service';
import {
  TeamPulseFrequencyEnum,
  TeamPulseQuestionKindEnum,
} from '../enum/team-pulse.enum';
import { TeamPulseRound } from '../entity/team-pulse-round.entity';

const RATING = TeamPulseQuestionKindEnum.RATING;
const TEXT = TeamPulseQuestionKindEnum.TEXT;

const qb = (result: unknown) => {
  const q: Record<string, jest.Mock> = {};
  for (const m of [
    'innerJoin',
    'innerJoinAndSelect',
    'select',
    'addSelect',
    'where',
    'andWhere',
    'orderBy',
    'setLock',
    'update',
    'set',
  ])
    q[m] = jest.fn().mockReturnValue(q);
  q.getOne = jest.fn().mockResolvedValue(Array.isArray(result) ? null : result);
  q.getOneOrFail = jest.fn().mockResolvedValue(result);
  q.getMany = jest.fn().mockResolvedValue(result);
  q.getRawOne = jest.fn().mockResolvedValue(result);
  q.getRawMany = jest.fn().mockResolvedValue(result);
  q.execute = jest.fn().mockResolvedValue({});
  return q;
};

describe('team pulse helpers', () => {
  it('schedules the next opening by frequency', () => {
    const from = new Date('2026-10-19T08:00:00Z');
    expect(nextOpening(from, TeamPulseFrequencyEnum.WEEKLY)).toEqual(
      new Date('2026-10-26T08:00:00Z'),
    );
    expect(nextOpening(from, TeamPulseFrequencyEnum.MONTHLY)).toEqual(
      new Date('2026-11-19T08:00:00Z'),
    );
    expect(nextOpening(from, TeamPulseFrequencyEnum.ONCE)).toBeNull();
  });

  it('hides a round’s score until three people have answered', () => {
    const ratings = { a: { count: 2, sum: 8, spread: [0, 0, 0, 2, 0] } };
    expect(
      roundScore({ responseCount: 2, ratings } as unknown as TeamPulseRound),
    ).toBeNull();
    expect(
      roundScore({
        responseCount: 3,
        ratings: { a: { count: 3, sum: 13, spread: [0, 0, 0, 2, 1] } },
      } as unknown as TeamPulseRound),
    ).toBe(4.3);
  });
});

describe('TeamPulseService', () => {
  const now = new Date('2026-10-19T08:00:00Z');
  const pulse = {
    id: 'p1',
    title: 'After Sunday',
    required: true,
    department: { id: 'd1', name: 'Choir' },
    questions: [
      { id: 'q1', kind: RATING, text: 'How well did we serve?' },
      { id: 'q2', kind: TEXT, text: 'What should we change?' },
    ],
  };
  let round: Record<string, unknown>;
  let workerRow: unknown;
  let leadRows: unknown[];
  let answered: boolean;

  const roundRepo = {
    query: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn((r) => Promise.resolve({ id: 'r-new', ...r })),
    create: jest.fn((r) => r),
    update: jest.fn(),
    createQueryBuilder: jest.fn(() => qb(round)),
  };
  const participationRepo = {
    exists: jest.fn(() => Promise.resolve(answered)),
    insert: jest.fn(),
  };
  const pulseRepoTx = { createQueryBuilder: jest.fn(() => qb(pulse)) };
  const txRepos = new Map<string, unknown>();
  const txHost = {
    tx: {
      getRepository: jest.fn(
        (e: { name: string }) => txRepos.get(e.name) as unknown,
      ),
    },
  };
  const workerRepo = {
    createQueryBuilder: jest.fn(() => qb(workerRow)),
  };
  const leadRepo = { createQueryBuilder: jest.fn(() => qb(leadRows)) };
  const clergyRepo = { exists: jest.fn().mockResolvedValue(false) };
  const pulseRepo = {
    save: jest.fn((p) => Promise.resolve({ id: 'p-new', ...p })),
    create: jest.fn((p) => p),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const departmentRepo = {
    findOneOrFail: jest.fn().mockResolvedValue({ id: 'd1', name: 'Choir' }),
  };
  const notifications = {
    notifyMember: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { log: jest.fn() };
  const service = new TeamPulseService(
    pulseRepo as never,
    roundRepo as never,
    participationRepo as never,
    departmentRepo as never,
    leadRepo as never,
    workerRepo as never,
    clergyRepo as never,
    txHost as never,
    notifications as never,
    audit as never,
    { format: () => 'Tue at 6:00 PM' } as never,
    { get: jest.fn().mockResolvedValue('Africa/Lagos') } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    round = {
      id: 'r1',
      opensAt: new Date('2026-10-18T08:00:00Z'),
      closesAt: new Date('2026-10-21T08:00:00Z'),
      responseCount: 3,
      ratings: { q1: { count: 3, sum: 12, spread: [0, 0, 1, 1, 1] } },
      comments: { q2: ['More rehearsal'] },
    };
    workerRow = { d: 'd1', s: null };
    leadRows = [];
    answered = false;
    txRepos.set('TeamPulse', pulseRepoTx);
    txRepos.set('TeamPulseRound', roundRepo);
    txRepos.set('TeamPulseParticipation', participationRepo);
  });

  describe('respond', () => {
    it('adds the answer to the totals and records only that the member answered', async () => {
      await service.respond(
        'm1',
        'r1',
        { answers: { q1: 5, q2: ' Start on time ' } },
        now,
      );
      expect(participationRepo.insert).toHaveBeenCalledWith({
        round: { id: 'r1' },
        member: { id: 'm1' },
      });
      const [, saved] = roundRepo.update.mock.calls[0];
      expect(saved.responseCount).toBe(4);
      expect(saved.ratings.q1).toEqual({
        count: 4,
        sum: 17,
        spread: [0, 0, 1, 1, 2],
      });
      expect(saved.comments.q2).toEqual(['More rehearsal', 'Start on time']);
      expect(JSON.stringify(saved)).not.toContain('m1');
    });

    it('turns away a second answer from the same person', async () => {
      answered = true;
      await expect(
        service.respond('m1', 'r1', { answers: { q1: 4 } }, now),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('turns away someone from another team', async () => {
      workerRow = { d: 'd9', s: null };
      await expect(
        service.respond('m1', 'r1', { answers: { q1: 4 } }, now),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('turns away answers once the check-in has closed, and ratings outside 1–5', async () => {
      await expect(
        service.respond(
          'm1',
          'r1',
          { answers: { q1: 4 } },
          new Date('2026-10-22T00:00:00Z'),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.respond('m1', 'r1', { answers: { q1: 9 } }, now),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('round results', () => {
    beforeEach(() => {
      roundRepo.findOne.mockImplementation(() =>
        Promise.resolve({ ...round, pulse }),
      );
    });

    it('shows averages and comments once three have answered', async () => {
      const result = await service.round('m1', 'r1', now);
      expect(result.score).toBe(4);
      expect(result.questions[0]).toEqual(
        expect.objectContaining({ average: 4, answered: 3 }),
      );
      expect(result.questions[1]).toEqual(
        expect.objectContaining({ comments: ['More rehearsal'] }),
      );
      expect(result.notYetAnswered).toBeUndefined();
    });

    it('keeps everything hidden with fewer than three answers', async () => {
      round.responseCount = 2;
      const result = await service.round('m1', 'r1', now);
      expect(result.score).toBeNull();
      expect(result.questions[0]).not.toHaveProperty('average');
      expect(result.questions[1]).not.toHaveProperty('comments');
    });
  });

  describe('create', () => {
    const dto = {
      departmentId: 'd1',
      title: 'After Sunday',
      frequency: TeamPulseFrequencyEnum.WEEKLY,
      questions: [{ kind: RATING, text: 'How well did we serve?' }],
    };

    it('lets only the department lead start one', async () => {
      await expect(service.create('m1', dto, now)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('needs at least one rating question', async () => {
      leadRows = [{ id: 'd1' }];
      await expect(
        service.create(
          'm1',
          { ...dto, questions: [{ kind: TEXT, text: 'Anything else?' }] },
          now,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('opens the first round straight away and tells the team', async () => {
      leadRows = [{ id: 'd1' }];
      workerRow = [{ id: 'w1' }, { id: 'w2' }];
      await service.create('m1', dto, now);
      expect(pulseRepo.save.mock.calls[0][0].nextOpenAt).toEqual(
        new Date('2026-10-26T08:00:00Z'),
      );
      expect(roundRepo.save.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          opensAt: now,
          closesAt: new Date('2026-10-22T08:00:00Z'),
          invitedCount: 2,
        }),
      );
      expect(
        notifications.notifyMember.mock.calls[0][0].push.memberIds,
      ).toEqual(['w1', 'w2']);
      expect(audit.log).toHaveBeenCalledWith(
        'TEAM_PULSE_STARTED',
        expect.anything(),
      );
    });
  });

  describe('overview', () => {
    it('scores each team on closed rounds only, for pastors', async () => {
      clergyRepo.exists.mockResolvedValue(true);
      pulseRepo.find.mockResolvedValue([{ ...pulse, active: true }]);
      const tally = (avg: number) => ({
        q1: { count: 4, sum: avg * 4, spread: [0, 0, 0, 0, 0] },
      });
      const closedOld = {
        opensAt: new Date('2026-10-05T00:00:00Z'),
        closesAt: new Date('2026-10-08T00:00:00Z'),
        responseCount: 4,
        invitedCount: 5,
        ratings: tally(3.5),
      };
      const closedNew = {
        opensAt: new Date('2026-10-12T00:00:00Z'),
        closesAt: new Date('2026-10-15T00:00:00Z'),
        responseCount: 4,
        invitedCount: 5,
        ratings: tally(4),
      };
      const open = {
        opensAt: new Date('2026-10-19T00:00:00Z'),
        closesAt: new Date('2026-10-22T00:00:00Z'),
        responseCount: 3,
        invitedCount: 5,
        ratings: tally(2),
      };
      const row = (r: typeof open) => ({
        id: 'x',
        pulse_id: 'p1',
        opens_at: r.opensAt,
        closes_at: r.closesAt,
        invited_count: r.invitedCount,
        response_count: r.responseCount,
        ratings: r.ratings,
      });
      roundRepo.query.mockResolvedValueOnce(
        [closedOld, closedNew, open].map(row),
      );
      const [dept] = (await service.overview('m1', now)) as {
        pulses: Record<string, unknown>[];
      }[];
      expect(dept.pulses[0]).toEqual(
        expect.objectContaining({
          latestScore: 4,
          previousScore: 3.5,
          responseRate: 80,
          scores: [3.5, 4],
        }),
      );
    });

    it('is for pastors only', async () => {
      clergyRepo.exists.mockResolvedValue(false);
      await expect(service.overview('m1', now)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('runDue', () => {
    it('opens due rounds and moves the next opening on past any missed ones', async () => {
      pulseRepo.find.mockResolvedValue([
        {
          ...pulse,
          frequency: TeamPulseFrequencyEnum.WEEKLY,
          responseWindowDays: 3,
          nextOpenAt: new Date('2026-10-05T08:00:00Z'),
        },
      ]);
      workerRow = [];
      round = [] as never;
      pulseRepo.findOne.mockResolvedValue({
        nextOpenAt: new Date('2026-10-26T08:00:00Z'),
      });
      const next = await service.runDue(now);
      expect(roundRepo.save).toHaveBeenCalledTimes(1);
      expect(pulseRepo.update).toHaveBeenCalledWith('p1', {
        nextOpenAt: new Date('2026-10-26T08:00:00Z'),
      });
      expect(next).toEqual(new Date('2026-10-26T08:00:00Z'));
    });
  });
});
