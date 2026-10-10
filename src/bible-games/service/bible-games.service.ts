import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { format, startOfMonth, subDays, subMonths } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { BibleGameProgress } from '../entity/bible-game-progress.entity';
import { BibleGameRound } from '../entity/bible-game-round.entity';
import { BibleGamePoints } from '../entity/bible-game-points.entity';
import { BibleGameCustomQuestion } from '../entity/bible-game-custom-question.entity';
import { BibleGameHidden } from '../entity/bible-game-hidden.entity';
import {
  BibleGameModeEnum,
  BibleGameRoundStatusEnum,
} from '../enum/bible-game-mode.enum';
import { AnswerDto, StartRoundDto } from '../dto/bible-game.dto';
import {
  KIND_LABEL,
  Question,
  customQuestion,
  refsInKey,
} from '../engine/questions';
import {
  DAILY_QUESTIONS,
  DAILY_SPEC,
  LEVEL_COUNT,
  LEVELS,
  PASS_MARK,
  QUESTIONS_PER_ROUND,
  levelSpec,
  pointsFor,
} from '../engine/levels';
import { buildRound, buildVerseRound } from '../engine/round';
import { randomRng, seededRng } from '../engine/rng';
import { ChurchTimezoneService } from '../../event/service/church-timezone.service';
import { CacheService } from '../../utility/service/cache.service';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { currentWeekStart } from '../../notes/util/note-streak';

// A little slack for the network between the member's tap and the server.
export const ANSWER_GRACE_SECONDS = 3;
// Questions from a member's recent rounds are avoided when building a new one.
const RECENT_ROUNDS = 8;
const WEEKLY_MIN_MEMBERS = 3;
const WEEKLY_MIN_VERSES = 3;
const WEEKLY_MAX_VERSES = 10;
// Points per right answer in the Daily and weekly rounds, as if a level-8 question.
const SHARED_ROUND_LEVEL = 8;
const SCOREBOARD_TTL_SECONDS = 30;
const CONTENT_TTL_SECONDS = 300;
const WEEKLY_TTL_SECONDS = 600;
// Finished rounds older than this are deleted when the member next plays; points live on in the ledger and totals.
const ROUND_RETENTION_DAYS = 60;
export const CONTENT_CACHE = 'bible-content';
const MASTERY_TIME_LIMIT = levelSpec(LEVEL_COUNT).timeLimit;

export type Period = 'month' | 'all';

export interface PublicQuestion {
  index: number;
  total: number;
  kind: string;
  kindLabel: string;
  prompt: string;
  passage?: string;
  ref?: string;
  options: string[];
  timeLimit: number;
}

export interface RoundResult {
  level: number | null;
  correct: number;
  total: number;
  passed: boolean | null;
  points: number;
  awarded: number;
  unlockedLevel: number | null;
  rankThisMonth: number | null;
}

export interface ScoreboardEntry {
  rank: number;
  memberId: string;
  name: string;
  level: number;
  points: number;
  // Top 3 last month.
  champion: 1 | 2 | 3 | null;
}

export interface Scoreboard {
  period: Period;
  entries: ScoreboardEntry[];
  me: {
    rank: number | null;
    points: number;
    behind: number | null;
    nextRank: number | null;
  };
  championMonth: string;
}

@Injectable()
export class BibleGamesService {
  constructor(
    @InjectRepository(BibleGameProgress)
    private readonly progressRepo: Repository<BibleGameProgress>,
    @InjectRepository(BibleGameRound)
    private readonly roundRepo: Repository<BibleGameRound>,
    @InjectRepository(BibleGamePoints)
    private readonly pointsRepo: Repository<BibleGamePoints>,
    @InjectRepository(BibleGameCustomQuestion)
    private readonly customRepo: Repository<BibleGameCustomQuestion>,
    @InjectRepository(BibleGameHidden)
    private readonly hiddenRepo: Repository<BibleGameHidden>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly churchTimezone: ChurchTimezoneService,
    private readonly cacheService: CacheService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async overview(memberId: string) {
    const [progress, timezone] = await Promise.all([
      this.progress(memberId),
      this.churchTimezone.get(),
    ]);
    const today = this.localDate(timezone);
    const week = currentWeekStart(timezone);
    const [daily, weekly, weeklyRefs, month, all] = await Promise.all([
      this.periodRound(memberId, BibleGameModeEnum.DAILY, today),
      this.periodRound(memberId, BibleGameModeEnum.WEEKLY, week),
      this.weeklyRefs(),
      this.standing(memberId, 'month', timezone),
      this.standing(memberId, 'all', timezone),
    ]);
    const streak = this.liveStreak(progress, today);
    return {
      levels: LEVELS.map((l) => ({
        level: l.level,
        tier: l.tier,
        timeLimit: l.timeLimit,
        unlocked: l.level <= progress.highestPassed + 1,
        passed: l.level <= progress.highestPassed,
        bestCorrect: progress.best[l.level]?.correct ?? null,
      })),
      nextLevel: Math.min(progress.highestPassed + 1, LEVEL_COUNT),
      highestPassed: progress.highestPassed,
      mastery: { unlocked: progress.highestPassed >= LEVEL_COUNT },
      inService: await this.inService(memberId),
      daily: {
        played: this.isFinished(daily),
        inProgress: !!daily && !this.isFinished(daily),
        correct: this.isFinished(daily) ? (daily?.correct ?? null) : null,
        total: DAILY_QUESTIONS,
        streak,
      },
      weekly: {
        available: weeklyRefs.length >= WEEKLY_MIN_VERSES,
        played: this.isFinished(weekly),
        inProgress: !!weekly && !this.isFinished(weekly),
        questions: Math.min(weeklyRefs.length, WEEKLY_MAX_VERSES),
      },
      points: {
        month: month.points,
        allTime: all.points,
        rankThisMonth: month.rank,
        rankAllTime: all.rank,
      },
      achievements: this.achievements(progress, streak),
      rules: {
        questionsPerRound: QUESTIONS_PER_ROUND,
        passMark: PASS_MARK,
        levels: LEVEL_COUNT,
      },
    };
  }

  async start(memberId: string, dto: StartRoundDto) {
    if (await this.inService(memberId)) {
      throw new ConflictException({
        code: 'SERVICE_IN_PROGRESS',
        message: 'Bible games open again after the service.',
      });
    }
    const progress = await this.progress(memberId);
    const timezone = await this.churchTimezone.get();
    const tenant = this.cls.get('tenantId') ?? 'default';
    const content = await this.content();
    const exclude = (q: Question) => this.isHidden(q, content.hidden);
    const extrasFor = (lvl: number) =>
      content.custom
        .filter((c) => c.levelMin <= lvl && c.levelMax >= lvl)
        .map((c) => customQuestion(randomRng(), c));

    let questions: Question[];
    let level: number | null = null;
    let periodKey: string | null = null;
    let timeLimit: number;

    switch (dto.mode) {
      case BibleGameModeEnum.LEVEL: {
        level = dto.level ?? progress.highestPassed + 1;
        if (level > progress.highestPassed + 1) {
          throw new ForbiddenException({
            code: 'LEVEL_LOCKED',
            message: `Pass level ${level - 1} to unlock level ${level}.`,
          });
        }
        const spec = levelSpec(level);
        timeLimit = spec.timeLimit;
        questions = buildRound(randomRng(), spec, QUESTIONS_PER_ROUND, {
          avoid: await this.recentKeys(memberId),
          exclude,
          extras: extrasFor(level),
        });
        break;
      }
      case BibleGameModeEnum.MASTERY: {
        if (progress.highestPassed < LEVEL_COUNT) {
          throw new ForbiddenException({
            code: 'MASTERY_LOCKED',
            message: `Pass level ${LEVEL_COUNT} to unlock Mastery.`,
          });
        }
        level = LEVEL_COUNT;
        timeLimit = MASTERY_TIME_LIMIT;
        questions = buildRound(
          randomRng(),
          levelSpec(LEVEL_COUNT),
          QUESTIONS_PER_ROUND,
          {
            avoid: await this.recentKeys(memberId),
            exclude,
            extras: extrasFor(LEVEL_COUNT),
          },
        );
        break;
      }
      case BibleGameModeEnum.DAILY: {
        periodKey = this.localDate(timezone);
        timeLimit = DAILY_SPEC.timeLimit;
        // Same seed for the whole church, so everyone gets the same Daily Challenge.
        questions = buildRound(
          seededRng(`${tenant}:daily:${periodKey}`),
          DAILY_SPEC,
          DAILY_QUESTIONS,
          { exclude },
        );
        break;
      }
      case BibleGameModeEnum.WEEKLY: {
        periodKey = currentWeekStart(timezone);
        const refs = await this.weeklyRefs();
        if (refs.length < WEEKLY_MIN_VERSES) {
          throw new NotFoundException({
            code: 'WEEKLY_NOT_AVAILABLE',
            message: "This week's verses aren't ready yet.",
          });
        }
        timeLimit = DAILY_SPEC.timeLimit;
        questions = buildVerseRound(
          seededRng(`${tenant}:weekly:${periodKey}`),
          refs,
          WEEKLY_MAX_VERSES,
          exclude,
        );
        break;
      }
    }

    if (!questions.length)
      throw new BadRequestException(
        'Could not build a round. Please try again.',
      );

    if (periodKey) {
      const existing = await this.periodRound(memberId, dto.mode, periodKey);
      if (this.isFinished(existing)) {
        throw new ConflictException({
          code: 'ALREADY_PLAYED',
          message: 'You have already played this one.',
        });
      }
      // Left part-way (or another round replaced it): carry on rather than lock them out for the day.
      if (existing) return this.resume(memberId, existing.id);
    }

    await this.roundRepo.update(
      { memberId, status: BibleGameRoundStatusEnum.ACTIVE },
      { status: BibleGameRoundStatusEnum.ABANDONED },
    );
    await this.txHost.tx.query(
      `DELETE FROM bible_game_rounds WHERE member_id = $1 AND created_at < now() - make_interval(days => $2)`,
      [memberId, ROUND_RETENTION_DAYS],
    );

    return this.saveNewRound(
      memberId,
      this.roundRepo.create({
        memberId,
        mode: dto.mode,
        level,
        periodKey,
        timeLimit,
        questions,
        answers: [],
        currentIndex: 0,
        askedAt: new Date(),
        status: BibleGameRoundStatusEnum.ACTIVE,
      }),
    );
  }

  private async resume(memberId: string, roundId: string) {
    const round = await this.roundRepo.findOneOrFail({
      where: { id: roundId, memberId },
    });
    if (round.answers.length >= round.questions.length) {
      throw new ConflictException({
        code: 'ALREADY_PLAYED',
        message: 'You have already played this one.',
      });
    }
    await this.roundRepo.update(
      { memberId, status: BibleGameRoundStatusEnum.ACTIVE },
      { status: BibleGameRoundStatusEnum.ABANDONED },
    );
    round.currentIndex = round.answers.length;
    round.askedAt = new Date();
    round.status = BibleGameRoundStatusEnum.ACTIVE;
    await this.roundRepo.save(round);
    return this.roundStart(round);
  }

  private roundStart(round: BibleGameRound) {
    return {
      roundId: round.id,
      mode: round.mode,
      level: round.level,
      total: round.questions.length,
      timeLimit: round.timeLimit,
      outcomes: round.answers.map((a) => a.correct),
      roundPoints: round.points,
      question: this.publicQuestion(round, round.currentIndex),
    };
  }

  private isFinished(round: { status: BibleGameRoundStatusEnum } | null) {
    return round?.status === BibleGameRoundStatusEnum.FINISHED;
  }

  async answer(memberId: string, roundId: string, dto: AnswerDto) {
    const round = await this.activeRound(memberId, roundId);
    if (
      dto.index !== round.currentIndex ||
      round.answers.length !== round.currentIndex
    ) {
      throw new ConflictException({
        code: 'OUT_OF_ORDER',
        message: 'This question has already been answered.',
      });
    }
    const q = round.questions[dto.index];
    const seconds = round.askedAt
      ? (Date.now() - round.askedAt.getTime()) / 1000
      : round.timeLimit;
    const inTime = seconds <= round.timeLimit + ANSWER_GRACE_SECONDS;
    const correct = inTime && dto.choice === q.answer;
    const points = correct
      ? pointsFor(
          this.pointsLevel(round),
          round.timeLimit - seconds,
          round.timeLimit,
        )
      : 0;

    round.answers = [
      ...round.answers,
      {
        choice: dto.choice ?? null,
        correct,
        points,
        seconds: Math.round(seconds * 10) / 10,
      },
    ];
    round.correct += correct ? 1 : 0;
    round.points += points;

    const finished = round.answers.length === round.questions.length;
    const result = finished ? await this.finish(round) : null;
    if (!finished) await this.roundRepo.save(round);

    return {
      correct,
      timedOut: !inTime,
      answer: q.answer,
      explain: q.explain,
      points,
      roundPoints: round.points,
      finished,
      result,
    };
  }

  async next(memberId: string, roundId: string) {
    const round = await this.activeRound(memberId, roundId);
    if (round.answers.length !== round.currentIndex + 1) {
      throw new ConflictException({
        code: 'OUT_OF_ORDER',
        message: 'Answer this question first.',
      });
    }
    round.currentIndex += 1;
    round.askedAt = new Date();
    await this.roundRepo.save(round);
    return this.publicQuestion(round, round.currentIndex);
  }

  async scoreboard(
    memberId: string | null,
    period: Period,
    limit = 50,
  ): Promise<Scoreboard> {
    const timezone = await this.churchTimezone.get();
    const key = this.scoreboardKey(period, timezone);
    let totals =
      await this.cacheService.get<
        { memberId: string; name: string; level: number; points: number }[]
      >(key);
    if (!totals) {
      // Reads the running totals (one row per player), never the full ledger. Ties go to whoever got there first.
      totals = (await (period === 'month'
        ? this.txHost.tx.query(
            `SELECT mo.member_id AS "memberId",
                    trim(concat_ws(' ', m.firstname, m.lastname)) AS name,
                    COALESCE(g.highest_passed, 0) AS level,
                    mo.points
             FROM bible_game_monthly mo
             JOIN members m ON m.id = mo.member_id
             LEFT JOIN bible_game_progress g ON g.member_id = mo.member_id
             WHERE mo.month = $1 AND mo.points > 0
             ORDER BY mo.points DESC, mo.updated_at ASC`,
            [this.monthKey(timezone)],
          )
        : this.txHost.tx.query(
            `SELECT g.member_id AS "memberId",
                    trim(concat_ws(' ', m.firstname, m.lastname)) AS name,
                    g.highest_passed AS level,
                    g.points_total AS points
             FROM bible_game_progress g
             JOIN members m ON m.id = g.member_id
             WHERE g.points_total > 0
             ORDER BY g.points_total DESC, g.updated_at ASC`,
          ))) as {
        memberId: string;
        name: string;
        level: number;
        points: number;
      }[];
      this.cacheService.set(key, totals, SCOREBOARD_TTL_SECONDS);
    }

    const champions = await this.lastMonthChampions(timezone);
    const ranked = totals.map((t, i) => ({ ...t, rank: i + 1 }));
    const mine = memberId
      ? ranked.find((t) => t.memberId === memberId)
      : undefined;
    const ahead = mine ? ranked[mine.rank - 2] : undefined;
    return {
      period,
      entries: ranked.slice(0, limit).map((t) => ({
        rank: t.rank,
        memberId: t.memberId,
        name: t.name,
        level: t.level,
        points: t.points,
        champion: (champions.get(t.memberId) ?? null) as 1 | 2 | 3 | null,
      })),
      me: {
        rank: mine?.rank ?? null,
        points: mine?.points ?? 0,
        behind: mine && ahead ? ahead.points - mine.points : null,
        nextRank: ahead?.rank ?? null,
      },
      championMonth: format(
        toZonedTime(subMonths(new Date(), 1), timezone),
        'MMMM',
      ),
    };
  }

  private async finish(round: BibleGameRound): Promise<RoundResult> {
    const progress = await this.progress(round.memberId);
    const timezone = await this.churchTimezone.get();
    let awarded = round.points;
    let passed: boolean | null = null;
    let unlockedLevel: number | null = null;

    if (round.mode === BibleGameModeEnum.LEVEL && round.level) {
      passed = round.correct >= PASS_MARK;
      const best = progress.best[round.level] ?? { correct: 0, points: 0 };
      // A failed round scores nothing; replaying a passed level only adds what beats your best on it.
      awarded = passed ? Math.max(0, round.points - best.points) : 0;
      progress.best = {
        ...progress.best,
        [round.level]: {
          correct: Math.max(best.correct, round.correct),
          points: passed ? Math.max(best.points, round.points) : best.points,
        },
      };
      // Only a pass of the very next level moves the member up, so a retry can never skip ahead.
      if (passed && round.level === progress.highestPassed + 1) {
        progress.highestPassed = round.level;
        unlockedLevel = round.level < LEVEL_COUNT ? round.level + 1 : null;
      }
    }

    if (round.mode === BibleGameModeEnum.DAILY) {
      const today = this.localDate(timezone);
      const yesterday = format(
        subDays(toZonedTime(new Date(), timezone), 1),
        'yyyy-MM-dd',
      );
      progress.dailyStreak =
        progress.lastDailyDate === yesterday
          ? progress.dailyStreak + 1
          : progress.lastDailyDate === today
            ? progress.dailyStreak
            : 1;
      progress.lastDailyDate = today;
    }

    if (round.correct === round.questions.length) progress.perfectRounds += 1;

    round.awarded = awarded;
    round.status = BibleGameRoundStatusEnum.FINISHED;
    round.finishedAt = new Date();
    await this.roundRepo.save(round);
    if (awarded > 0) {
      progress.pointsTotal += awarded;
      await this.pointsRepo.save(
        this.pointsRepo.create({
          memberId: round.memberId,
          mode: round.mode,
          points: awarded,
          roundId: round.id,
        }),
      );
      await this.txHost.tx.query(
        `INSERT INTO bible_game_monthly (member_id, month, points) VALUES ($1, $2, $3)
         ON CONFLICT (member_id, month)
         DO UPDATE SET points = bible_game_monthly.points + EXCLUDED.points, updated_at = now()`,
        [round.memberId, this.monthKey(timezone), awarded],
      );
      this.forgetScoreboards(timezone);
    }
    await this.progressRepo.save(progress);

    const month = await this.standing(round.memberId, 'month', timezone, true);
    return {
      level: round.level,
      correct: round.correct,
      total: round.questions.length,
      passed,
      points: round.points,
      awarded,
      unlockedLevel,
      rankThisMonth: month.rank,
    };
  }

  private async saveNewRound(memberId: string, round: BibleGameRound) {
    try {
      return this.roundStart(await this.roundRepo.save(round));
    } catch (err) {
      // Two starts at once (double tap, or the page loading twice): the second hits the
      // one-per-day/week index, so it picks up the round the first one just made.
      if ((err as { code?: string }).code === '23505' && round.periodKey) {
        const existing = await this.periodRound(
          memberId,
          round.mode,
          round.periodKey,
        );
        if (existing && !this.isFinished(existing)) {
          return this.resume(memberId, existing.id);
        }
        throw new ConflictException({
          code: 'ALREADY_PLAYED',
          message: 'You have already played this one.',
        });
      }
      throw err;
    }
  }

  private publicQuestion(round: BibleGameRound, index: number): PublicQuestion {
    const q = round.questions[index];
    return {
      index,
      total: round.questions.length,
      kind: q.kind,
      kindLabel: KIND_LABEL[q.kind],
      prompt: q.prompt,
      ...(q.passage ? { passage: q.passage } : {}),
      ...(q.ref ? { ref: q.ref } : {}),
      options: q.options,
      timeLimit: round.timeLimit,
    };
  }

  private pointsLevel(round: BibleGameRound): number {
    if (
      round.mode === BibleGameModeEnum.LEVEL ||
      round.mode === BibleGameModeEnum.MASTERY
    ) {
      return round.level ?? 1;
    }
    return SHARED_ROUND_LEVEL;
  }

  private async activeRound(
    memberId: string,
    roundId: string,
  ): Promise<BibleGameRound> {
    const round = await this.roundRepo.findOne({
      where: { id: roundId, memberId },
    });
    if (!round) throw new NotFoundException('Round not found');
    if (round.status !== BibleGameRoundStatusEnum.ACTIVE) {
      throw new ConflictException({
        code: 'ROUND_OVER',
        message: 'This round has ended.',
      });
    }
    return round;
  }

  private async progress(memberId: string): Promise<BibleGameProgress> {
    const found = await this.progressRepo.findOne({ where: { memberId } });
    return (
      found ??
      this.progressRepo.create({
        memberId,
        highestPassed: 0,
        best: {},
        dailyStreak: 0,
        lastDailyDate: null,
        perfectRounds: 0,
        pointsTotal: 0,
      })
    );
  }

  private periodRound(
    memberId: string,
    mode: BibleGameModeEnum,
    periodKey: string,
  ) {
    return this.roundRepo.findOne({
      where: { memberId, mode, periodKey },
      select: { id: true, correct: true, status: true },
    });
  }

  // Checked in to a service that is happening right now: no games during the service.
  private async inService(memberId: string): Promise<boolean> {
    const rows = (await this.txHost.tx.query(
      `SELECT 1 FROM attendances a
       JOIN service_slots ss ON ss.event_id = a.event_id
       WHERE a.member_id = $1 AND a.status IN ('PRESENT', 'LATE')
         AND now() BETWEEN ss.start_time AND ss.end_time
       LIMIT 1`,
      [memberId],
    )) as unknown[];
    return rows.length > 0;
  }

  private async recentKeys(memberId: string): Promise<Set<string>> {
    const rows = (await this.txHost.tx.query(
      `SELECT q->>'key' AS key
       FROM (SELECT questions FROM bible_game_rounds WHERE member_id = $1 ORDER BY created_at DESC LIMIT $2) r,
            jsonb_array_elements(r.questions) q`,
      [memberId, RECENT_ROUNDS],
    )) as { key: string }[];
    return new Set(rows.map((r) => r.key));
  }

  // Verses at least 3 members put in their notes this past week; ranges and chapters use their first verse.
  private async weeklyRefs(): Promise<string[]> {
    const key = this.cacheService.key('bible-weekly-refs', 'current');
    const cached = await this.cacheService.get<string[]>(key);
    if (cached) return cached;
    const rows = (await this.txHost.tx
      .query(
        `SELECT split_part(ref, '-', 1) AS ref, COUNT(DISTINCT n.member_id)::int AS members
       FROM notes n, jsonb_array_elements_text(n.scripture_refs) AS ref
       WHERE n.created_at >= now() - interval '7 days' AND n.word_count > 0
         AND ref ~ '^[1-3A-Z]{3}\\.[0-9]+\\.[0-9]+'
       GROUP BY split_part(ref, '-', 1)
       HAVING COUNT(DISTINCT n.member_id) >= $1
       ORDER BY members DESC, ref
       LIMIT $2`,
        [WEEKLY_MIN_MEMBERS, WEEKLY_MAX_VERSES],
      )
      .catch(() => [])) as { ref: string }[];
    const refs = rows.map((r) => r.ref);
    this.cacheService.set(key, refs, WEEKLY_TTL_SECONDS);
    return refs;
  }

  private async standing(
    memberId: string,
    period: Period,
    timezone: string,
    fresh = false,
  ) {
    if (fresh) this.forgetScoreboards(timezone);
    const board = await this.scoreboard(memberId, period, 1);
    return { rank: board.me.rank, points: board.me.points };
  }

  private async lastMonthChampions(
    timezone: string,
  ): Promise<Map<string, number>> {
    const month = this.monthKey(timezone, 1);
    const key = this.cacheService.key('bible-champions', month);
    let rows = await this.cacheService.get<{ memberId: string }[]>(key);
    if (!rows) {
      rows = (await this.txHost.tx.query(
        `SELECT member_id AS "memberId" FROM bible_game_monthly
         WHERE month = $1 AND points > 0
         ORDER BY points DESC, updated_at ASC LIMIT 3`,
        [month],
      )) as { memberId: string }[];
      this.cacheService.set(key, rows, 3600);
    }
    return new Map(rows.map((r, i) => [r.memberId, i + 1]));
  }

  private scoreboardKey(period: Period, timezone: string): string {
    return this.cacheService.key(
      'bible-scoreboard',
      period === 'month' ? `month:${this.monthKey(timezone)}` : 'all',
    );
  }

  private forgetScoreboards(timezone: string): void {
    this.cacheService.del(this.scoreboardKey('month', timezone));
    this.cacheService.del(this.scoreboardKey('all', timezone));
  }

  // Hidden questions and church-written ones, cached briefly; admin changes clear it.
  async content(): Promise<{
    hidden: Set<string>;
    custom: BibleGameCustomQuestion[];
  }> {
    const key = this.cacheService.key(CONTENT_CACHE, 'all');
    const cached = await this.cacheService.get<{
      hidden: string[];
      custom: BibleGameCustomQuestion[];
    }>(key);
    if (cached)
      return { hidden: new Set(cached.hidden), custom: cached.custom };
    const [hidden, custom] = await Promise.all([
      this.hiddenRepo.find({ select: { key: true } }),
      this.customRepo.find({ where: { active: true } }),
    ]);
    const value = { hidden: hidden.map((h) => h.key), custom };
    this.cacheService.set(key, value, CONTENT_TTL_SECONDS);
    return { hidden: new Set(value.hidden), custom };
  }

  isHidden(q: Question, hidden: ReadonlySet<string>): boolean {
    return (
      hidden.has(q.key) ||
      refsInKey(q.key).some((r) => hidden.has(`verse:${r}`))
    );
  }

  private liveStreak(progress: BibleGameProgress, today: string): number {
    if (!progress.lastDailyDate) return 0;
    const yesterday = format(
      subDays(new Date(`${today}T12:00:00`), 1),
      'yyyy-MM-dd',
    );
    return progress.lastDailyDate === today ||
      progress.lastDailyDate === yesterday
      ? progress.dailyStreak
      : 0;
  }

  private achievements(progress: BibleGameProgress, streak: number) {
    return [
      {
        id: 'first-steps',
        title: 'First steps',
        description: 'Pass level 1',
        earned: progress.highestPassed >= 1,
      },
      {
        id: 'halfway',
        title: 'Halfway there',
        description: 'Pass level 10',
        earned: progress.highestPassed >= 10,
      },
      {
        id: 'champion',
        title: 'Bible champion',
        description: `Pass all ${LEVEL_COUNT} levels`,
        earned: progress.highestPassed >= LEVEL_COUNT,
      },
      {
        id: 'perfect',
        title: 'Perfect round',
        description: 'Get every question right in a round',
        earned: progress.perfectRounds > 0,
      },
      {
        id: 'week-streak',
        title: 'Seven days',
        description: 'Play the Daily Challenge 7 days in a row',
        earned: streak >= 7 || progress.dailyStreak >= 7,
      },
    ];
  }

  private localDate(timezone: string): string {
    return format(toZonedTime(new Date(), timezone), 'yyyy-MM-dd');
  }

  // "2026-10-01" for this month (or `monthsAgo` back) in the church's timezone: the bible_game_monthly key.
  private monthKey(timezone: string, monthsAgo = 0): string {
    return format(
      startOfMonth(subMonths(toZonedTime(new Date(), timezone), monthsAgo)),
      'yyyy-MM-dd',
    );
  }
}
