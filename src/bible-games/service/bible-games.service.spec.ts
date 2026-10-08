import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { format, subDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { BibleGamesService } from './bible-games.service';
import { BibleGameProgress } from '../entity/bible-game-progress.entity';
import { BibleGameRound } from '../entity/bible-game-round.entity';
import { BibleGamePoints } from '../entity/bible-game-points.entity';
import { BibleGameCustomQuestion } from '../entity/bible-game-custom-question.entity';
import { BibleGameHidden } from '../entity/bible-game-hidden.entity';
import {
  BibleGameModeEnum,
  BibleGameRoundStatusEnum,
} from '../enum/bible-game-mode.enum';
import { ChurchTimezoneService } from '../../event/service/church-timezone.service';
import { CacheService } from '../../utility/service/cache.service';
import type { Question } from '../engine/questions';

const TZ = 'Africa/Lagos';
const localDay = (daysAgo = 0) =>
  format(subDays(toZonedTime(new Date(), TZ), daysAgo), 'yyyy-MM-dd');

const question = (i: number): Question => ({
  key: `k${i}`,
  kind: 'testament',
  prompt: `Q${i}`,
  options: ['Old Testament', 'New Testament'],
  answer: 0,
  explain: 'Because.',
});

function round(over: Partial<BibleGameRound> = {}): BibleGameRound {
  return {
    id: 'r1',
    memberId: 'm1',
    mode: BibleGameModeEnum.LEVEL,
    level: 1,
    periodKey: null,
    timeLimit: 20,
    questions: Array.from({ length: 10 }, (_, i) => question(i)),
    answers: [],
    currentIndex: 0,
    askedAt: new Date(),
    correct: 0,
    points: 0,
    awarded: 0,
    status: BibleGameRoundStatusEnum.ACTIVE,
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as BibleGameRound;
}

describe('BibleGamesService', () => {
  let service: BibleGamesService;
  const progressRepo = {
    findOne: jest.fn(),
    create: jest.fn((v) => ({ ...v })),
    save: jest.fn(async (v) => v),
  };
  const roundRepo = {
    findOne: jest.fn(),
    update: jest.fn(),
    create: jest.fn((v) => ({ ...v })),
    save: jest.fn(async (v) => ({ id: 'r1', ...v })),
  };
  const pointsRepo = {
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => v),
  };
  const query = jest.fn();
  const customRepo = { find: jest.fn().mockResolvedValue([]) };
  const hiddenRepo = { find: jest.fn().mockResolvedValue([]) };
  const cacheService = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(1),
    key: jest.fn((ns: string, id: string) => `${ns}:${id}`),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    query.mockResolvedValue([]);
    customRepo.find.mockResolvedValue([]);
    hiddenRepo.find.mockResolvedValue([]);
    progressRepo.findOne.mockResolvedValue(null);
    roundRepo.findOne.mockResolvedValue(null);
    roundRepo.save.mockImplementation(async (v) => ({ id: 'r1', ...v }));
    const module = await Test.createTestingModule({
      providers: [
        BibleGamesService,
        {
          provide: getRepositoryToken(BibleGameProgress),
          useValue: progressRepo,
        },
        { provide: getRepositoryToken(BibleGameRound), useValue: roundRepo },
        { provide: getRepositoryToken(BibleGamePoints), useValue: pointsRepo },
        {
          provide: getRepositoryToken(BibleGameCustomQuestion),
          useValue: customRepo,
        },
        { provide: getRepositoryToken(BibleGameHidden), useValue: hiddenRepo },
        {
          provide: TransactionHost,
          useValue: { tx: { query: (...a: unknown[]) => query(...a) } },
        },
        {
          provide: ChurchTimezoneService,
          useValue: { get: jest.fn().mockResolvedValue(TZ) },
        },
        { provide: CacheService, useValue: cacheService },
        {
          provide: ClsService,
          useValue: { get: jest.fn().mockReturnValue('church-1') },
        },
      ],
    }).compile();
    service = module.get(BibleGamesService);
  });

  describe('start', () => {
    it('waits until the service ends for members checked in to it', async () => {
      query.mockResolvedValueOnce([{ '?column?': 1 }]);
      await expect(
        service.start('m1', { mode: BibleGameModeEnum.LEVEL, level: 1 }),
      ).rejects.toMatchObject({
        response: { code: 'SERVICE_IN_PROGRESS' },
      });
    });

    it('refuses a level that is not unlocked yet', async () => {
      await expect(
        service.start('m1', { mode: BibleGameModeEnum.LEVEL, level: 3 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('starts level 1 and never sends the right answer', async () => {
      const res = await service.start('m1', {
        mode: BibleGameModeEnum.LEVEL,
        level: 1,
      });
      expect(res.total).toBe(10);
      expect(res.timeLimit).toBe(20);
      expect(res.question).not.toHaveProperty('answer');
      expect(res.question).not.toHaveProperty('explain');
      expect(res.question).not.toHaveProperty('key');
      expect(roundRepo.update).toHaveBeenCalledWith(
        { memberId: 'm1', status: BibleGameRoundStatusEnum.ACTIVE },
        { status: BibleGameRoundStatusEnum.ABANDONED },
      );
    });

    it('only lets a member play the Daily Challenge once a day', async () => {
      roundRepo.findOne.mockResolvedValueOnce({ id: 'earlier', correct: 4 });
      await expect(
        service.start('m1', { mode: BibleGameModeEnum.DAILY }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('opens the weekly round only when enough verses were noted', async () => {
      query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ ref: 'JHN.3.16' }, { ref: 'ROM.8.28' }]);
      await expect(
        service.start('m1', { mode: BibleGameModeEnum.WEEKLY }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('keeps Mastery locked until level 20 is passed', async () => {
      progressRepo.findOne.mockResolvedValue({
        memberId: 'm1',
        highestPassed: 19,
        best: {},
        dailyStreak: 0,
        lastDailyDate: null,
        perfectRounds: 0,
      });
      await expect(
        service.start('m1', { mode: BibleGameModeEnum.MASTERY }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('church content', () => {
    it('never puts a hidden verse in a round', async () => {
      hiddenRepo.find.mockResolvedValue([{ key: 'verse:GEN.1.1' }]);
      for (let i = 0; i < 5; i++) {
        await service.start('m1', { mode: BibleGameModeEnum.LEVEL, level: 1 });
        const saved = roundRepo.save.mock.calls.at(-1)[0] as BibleGameRound;
        expect(saved.questions.some((q) => q.key.includes('GEN.1.1'))).toBe(
          false,
        );
      }
    });

    it("mixes the church's own questions into level rounds within their levels", async () => {
      customRepo.find.mockResolvedValue([
        {
          id: 'c1',
          prompt: 'Who built the ark?',
          options: ['Noah', 'Moses'],
          answer: 0,
          explain: null,
          levelMin: 1,
          levelMax: 3,
          active: true,
        },
        {
          id: 'c2',
          prompt: 'Too hard for level 1',
          options: ['A', 'B'],
          answer: 1,
          explain: null,
          levelMin: 10,
          levelMax: 20,
          active: true,
        },
      ]);
      await service.start('m1', { mode: BibleGameModeEnum.LEVEL, level: 1 });
      const saved = roundRepo.save.mock.calls.at(-1)[0] as BibleGameRound;
      const custom = saved.questions.filter((q) => q.kind === 'custom');
      expect(custom.map((q) => q.key)).toEqual(['custom:c1']);
      expect(custom[0].options[custom[0].answer]).toBe('Noah');
    });

    it("clears out the member's rounds older than 60 days when they play", async () => {
      await service.start('m1', { mode: BibleGameModeEnum.LEVEL, level: 1 });
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM bible_game_rounds'),
        ['m1', 60],
      );
    });
  });

  describe('answer', () => {
    it('scores a quick right answer', async () => {
      roundRepo.findOne.mockResolvedValueOnce(
        round({ askedAt: new Date(Date.now() - 2000) }),
      );
      const res = await service.answer('m1', 'r1', { index: 0, choice: 0 });
      expect(res).toMatchObject({ correct: true, finished: false, answer: 0 });
      expect(res.points).toBeGreaterThan(10);
    });

    it('scores nothing for a right answer after the time runs out', async () => {
      roundRepo.findOne.mockResolvedValueOnce(
        round({ askedAt: new Date(Date.now() - 60_000) }),
      );
      const res = await service.answer('m1', 'r1', { index: 0, choice: 0 });
      expect(res).toMatchObject({ correct: false, timedOut: true, points: 0 });
    });

    it('rejects answering the same question twice', async () => {
      roundRepo.findOne.mockResolvedValueOnce(
        round({
          answers: [{ choice: 0, correct: true, points: 10, seconds: 1 }],
        }),
      );
      await expect(
        service.answer('m1', 'r1', { index: 0, choice: 0 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('moves to the next question only after answering', async () => {
      roundRepo.findOne.mockResolvedValueOnce(round());
      await expect(service.next('m1', 'r1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      roundRepo.findOne.mockResolvedValueOnce(
        round({
          answers: [{ choice: 0, correct: true, points: 10, seconds: 1 }],
        }),
      );
      const q = await service.next('m1', 'r1');
      expect(q).toMatchObject({ index: 1, prompt: 'Q1' });
      expect(q).not.toHaveProperty('answer');
    });
  });

  describe('finishing a round', () => {
    const almostDone = (over: Partial<BibleGameRound>) =>
      round({
        answers: Array.from({ length: 9 }, () => ({
          choice: 0,
          correct: true,
          points: 12,
          seconds: 3,
        })),
        currentIndex: 9,
        correct: 8,
        points: 96,
        ...over,
      });

    it('unlocks the next level on 7/10 and adds points to the scoreboard', async () => {
      roundRepo.findOne.mockResolvedValueOnce(almostDone({}));
      const res = await service.answer('m1', 'r1', { index: 9, choice: 0 });
      expect(res.finished).toBe(true);
      expect(res.result).toMatchObject({
        correct: 9,
        passed: true,
        unlockedLevel: 2,
      });
      expect(progressRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ highestPassed: 1 }),
      );
      expect(pointsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          memberId: 'm1',
          points: res.result!.awarded,
        }),
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO bible_game_monthly'),
        ['m1', expect.stringMatching(/^\d{4}-\d{2}-01$/), res.result!.awarded],
      );
      expect(progressRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ pointsTotal: res.result!.awarded }),
      );
    });

    it('only adds the improvement when replaying a level', async () => {
      progressRepo.findOne.mockResolvedValue({
        memberId: 'm1',
        highestPassed: 1,
        best: { 1: { correct: 9, points: 100 } },
        dailyStreak: 0,
        lastDailyDate: null,
        perfectRounds: 0,
      });
      roundRepo.findOne.mockResolvedValueOnce(
        almostDone({ askedAt: new Date() }),
      );
      const res = await service.answer('m1', 'r1', { index: 9, choice: 0 });
      expect(res.result!.points).toBeGreaterThan(100);
      expect(res.result!.awarded).toBe(res.result!.points - 100);
    });

    it('awards nothing for a replay that does not beat the best', async () => {
      progressRepo.findOne.mockResolvedValue({
        memberId: 'm1',
        highestPassed: 1,
        best: { 1: { correct: 10, points: 150 } },
        dailyStreak: 0,
        lastDailyDate: null,
        perfectRounds: 0,
      });
      roundRepo.findOne.mockResolvedValueOnce(almostDone({}));
      const res = await service.answer('m1', 'r1', { index: 9, choice: 0 });
      expect(res.result!.awarded).toBe(0);
      expect(pointsRepo.save).not.toHaveBeenCalled();
    });

    it('continues the daily streak from yesterday', async () => {
      progressRepo.findOne.mockResolvedValue({
        memberId: 'm1',
        highestPassed: 0,
        best: {},
        dailyStreak: 4,
        lastDailyDate: localDay(1),
        perfectRounds: 0,
      });
      roundRepo.findOne.mockResolvedValueOnce(
        round({
          mode: BibleGameModeEnum.DAILY,
          level: null,
          periodKey: localDay(),
          questions: Array.from({ length: 5 }, (_, i) => question(i)),
          answers: Array.from({ length: 4 }, () => ({
            choice: 0,
            correct: true,
            points: 20,
            seconds: 2,
          })),
          currentIndex: 4,
          correct: 4,
          points: 80,
        }),
      );
      await service.answer('m1', 'r1', { index: 4, choice: 0 });
      expect(progressRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          dailyStreak: 5,
          lastDailyDate: localDay(),
          perfectRounds: 1,
        }),
      );
    });
  });

  it('ranks the scoreboard and shows how far behind the next person you are', async () => {
    query
      .mockResolvedValueOnce([
        { memberId: 'a', name: 'Grace Adebayo', level: 9, points: 500 },
        { memberId: 'm1', name: 'You Member', level: 3, points: 320 },
        { memberId: 'c', name: 'Joseph Eze', level: 2, points: 100 },
      ])
      .mockResolvedValueOnce([{ memberId: 'a' }]);
    const board = await service.scoreboard('m1', 'month');
    expect(board.entries.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(board.entries[0]).toMatchObject({
      name: 'Grace Adebayo',
      champion: 1,
    });
    expect(board.me).toEqual({
      rank: 2,
      points: 320,
      behind: 180,
      nextRank: 1,
    });
  });
});
