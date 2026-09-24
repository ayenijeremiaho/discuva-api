import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Game } from '../entity/game.entity';
import { GameQuestion } from '../entity/game-question.entity';
import { GameSession } from '../entity/game-session.entity';
import { GameParticipant } from '../entity/game-participant.entity';
import { GameResponse } from '../entity/game-response.entity';
import {
  GameSessionStatusEnum,
  GameStatusEnum,
} from '../enum/game-status.enum';
import {
  CreateGameDto,
  CreateGameQuestionDto,
  ReorderQuestionsDto,
  SubmitAnswerDto,
  UpdateGameDto,
  UpdateGameQuestionDto,
} from '../dto/game.dto';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { Admin } from '../../admin/entity/admin.entity';
import { Department } from '../../department/entity/department.entity';
import { ChurchClass } from '../../classes/entity/church-class.entity';

const MIN_SPEED_BONUS_FRACTION = 0.5;
// Slack past the question's own timeLimitSeconds before a submission is
// rejected as late — members count down locally from
// currentQuestionStartedAt, so a click registered right at 0s legitimately
// lands at the server a beat later on network/render time. Without this,
// answering was silently unbounded (MIN_SPEED_BONUS_FRACTION just floors
// the score, it never rejects) — a member could answer arbitrarily late
// as long as the host hadn't advanced yet.
const ANSWER_GRACE_SECONDS = 2;

export interface PublicGameQuestion {
  id: string;
  order: number;
  questionText: string;
  options: string[];
  timeLimitSeconds: number;
  points: number;
}

export interface LeaderboardEntry {
  participantId: string;
  memberId: string;
  memberName: string;
  totalScore: number;
}

export interface MyGameHistoryEntry {
  sessionCode: string;
  gameTitle: string;
  playedAt: Date | null;
  totalScore: number;
  rank: number;
  participantCount: number;
  correctCount: number;
  answeredCount: number;
}

export interface GameSessionStatePayload {
  sessionCode: string;
  gameTitle: string;
  status: GameSessionStatusEnum;
  currentQuestionIndex: number | null;
  totalQuestions: number;
  currentQuestion: PublicGameQuestion | null;
  // Epoch ms the current question started — clients tick their own countdown
  // from this instead of trusting secondsRemaining, which is only a snapshot
  // as of the last broadcast and goes stale between events.
  currentQuestionStartedAt: number | null;
  secondsRemaining: number | null;
  answeredCount: number;
  participantCount: number;
  leaderboard: LeaderboardEntry[];
}

export type GameListItem = Game & {
  activeSessionCode: string | null;
  // Count of ENDED sessions for this game — lets the games list tell a
  // never-played game apart from one that's simply idle between sessions.
  // Both previously showed the same "Draft" label (Game.status reverts to
  // DRAFT after every session ends, not to some distinct "played" state),
  // which read as "this has never been used" even for a game run ten
  // times already.
  playCount: number;
};

export interface GameSessionSummary {
  sessionCode: string;
  status: GameSessionStatusEnum;
  startedAt: Date | null;
  endedAt: Date | null;
  participantCount: number;
  topScore: number | null;
  topScorerName: string | null;
}

@Injectable()
export class GameService {
  constructor(
    @InjectRepository(Game)
    private readonly gameRepo: Repository<Game>,
    @InjectRepository(GameQuestion)
    private readonly questionRepo: Repository<GameQuestion>,
    @InjectRepository(GameSession)
    private readonly sessionRepo: Repository<GameSession>,
    @InjectRepository(GameParticipant)
    private readonly participantRepo: Repository<GameParticipant>,
    @InjectRepository(GameResponse)
    private readonly responseRepo: Repository<GameResponse>,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ─── Game CRUD ────────────────────────────────────────────────────────────

  async createGame(dto: CreateGameDto, admin: Admin): Promise<Game> {
    const game = this.gameRepo.create({
      title: dto.title,
      description: dto.description ?? null,
      status: GameStatusEnum.DRAFT,
      createdBy: { id: admin.id } as Admin,
      department: dto.departmentId
        ? ({ id: dto.departmentId } as Department)
        : null,
      churchClass: dto.churchClassId
        ? ({ id: dto.churchClassId } as ChurchClass)
        : null,
    });
    const saved = await this.gameRepo.save(game);
    this.auditLogService.log('GAME_CREATED', {
      actorId: admin.id,
      targetId: saved.id,
      targetName: saved.title,
      metadata: { title: saved.title },
    });
    return saved;
  }

  async updateGame(
    id: string,
    dto: UpdateGameDto,
    admin: Admin,
  ): Promise<Game> {
    const game = await this.getGameOrThrow(id);
    if (dto.title !== undefined) game.title = dto.title;
    if (dto.description !== undefined) game.description = dto.description;
    if (dto.departmentId !== undefined) {
      game.department = dto.departmentId
        ? ({ id: dto.departmentId } as Department)
        : null;
    }
    if (dto.churchClassId !== undefined) {
      game.churchClass = dto.churchClassId
        ? ({ id: dto.churchClassId } as ChurchClass)
        : null;
    }
    const saved = await this.gameRepo.save(game);
    this.auditLogService.log('GAME_UPDATED', {
      actorId: admin.id,
      targetId: id,
      targetName: saved.title,
      metadata: { title: saved.title, changes: Object.keys(dto) },
    });
    return saved;
  }

  async deleteGame(id: string, admin: Admin): Promise<void> {
    const game = await this.getGameOrThrow(id);
    const { title } = game;
    await this.gameRepo.remove(game);
    this.auditLogService.log('GAME_DELETED', {
      actorId: admin.id,
      targetId: id,
      targetName: title,
      metadata: { title },
    });
  }

  async getGame(id: string): Promise<GameListItem> {
    const game = await this.getGameOrThrow(id);
    const [enriched] = await this.attachActiveSessionCodes([game]);
    return enriched;
  }

  async listGames(
    page = 1,
    limit = 20,
    search?: string,
    status?: GameStatusEnum,
  ): Promise<PaginationResponseDto<GameListItem>> {
    const qb = this.gameRepo
      .createQueryBuilder('game')
      .leftJoinAndSelect('game.department', 'department')
      .leftJoinAndSelect('game.churchClass', 'churchClass')
      .orderBy('game.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (search?.trim()) {
      qb.andWhere(
        '(game.title ILIKE :search OR game.description ILIKE :search)',
        { search: `%${search.trim()}%` },
      );
    }
    if (status) {
      qb.andWhere('game.status = :status', { status });
    }

    const [games, total] = await qb.getManyAndCount();
    const enriched = await this.attachActiveSessionCodes(games);
    return UtilityService.createPaginationResponse(
      enriched,
      page,
      limit,
      total,
    );
  }

  // Past (and current) sessions for a game — the data behind results/
  // history already fully persists (GameParticipant.totalScore,
  // GameResponse's per-answer audit trail), the actual gap was
  // discoverability: no way to find a session's code again once you've
  // navigated away from wherever it was started. Includes LIVE sessions
  // too, not just ENDED ones, so this view doubles as the "resume a stuck
  // session" surface for a game whose host closed their tab.
  async listGameSessions(
    gameId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginationResponseDto<GameSessionSummary>> {
    await this.getGameOrThrow(gameId);
    const [sessions, total] = await this.sessionRepo.findAndCount({
      where: { game: { id: gameId } },
      order: { startedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    if (sessions.length === 0) {
      return UtilityService.createPaginationResponse([], page, limit, total);
    }

    const sessionIds = sessions.map((s) => s.id);
    // Two bounded aggregate queries rather than N+1 per-session lookups.
    const [countRows, topScorerRows] = await Promise.all([
      this.participantRepo
        .createQueryBuilder('p')
        .select('p.session_id', 'sessionId')
        .addSelect('COUNT(*)::int', 'count')
        .where('p.session_id IN (:...sessionIds)', { sessionIds })
        .groupBy('p.session_id')
        .getRawMany<{ sessionId: string; count: number }>(),
      // DISTINCT ON is the natural Postgres shape for "top 1 row per
      // group" — createdAt is a deterministic tie-break on equal scores;
      // without it Postgres's pick among ties is arbitrary and "the
      // winner" would flicker between requests.
      this.participantRepo
        .createQueryBuilder('p')
        .distinctOn(['p.session_id'])
        .innerJoin('p.member', 'm')
        .select('p.session_id', 'sessionId')
        .addSelect('p.total_score', 'topScore')
        .addSelect("m.firstname || ' ' || m.lastname", 'topScorerName')
        .where('p.session_id IN (:...sessionIds)', { sessionIds })
        .orderBy('p.session_id', 'ASC')
        .addOrderBy('p.total_score', 'DESC')
        .addOrderBy('p.created_at', 'ASC')
        .getRawMany<{
          sessionId: string;
          topScore: number;
          topScorerName: string;
        }>(),
    ]);

    const countBySessionId = new Map(
      countRows.map((r) => [r.sessionId, Number(r.count)]),
    );
    const topScorerBySessionId = new Map(
      topScorerRows.map((r) => [
        r.sessionId,
        { topScore: Number(r.topScore), topScorerName: r.topScorerName },
      ]),
    );

    const data: GameSessionSummary[] = sessions.map((s) => ({
      sessionCode: s.sessionCode,
      status: s.status,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      participantCount: countBySessionId.get(s.id) ?? 0,
      topScore: topScorerBySessionId.get(s.id)?.topScore ?? null,
      topScorerName: topScorerBySessionId.get(s.id)?.topScorerName ?? null,
    }));

    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  // ─── Questions ────────────────────────────────────────────────────────────

  async addQuestion(
    gameId: string,
    dto: CreateGameQuestionDto,
    admin: Admin,
  ): Promise<GameQuestion> {
    const game = await this.getGameOrThrow(gameId);
    this.assertValidCorrectIndex(dto.options, dto.correctOptionIndex);

    const order = await this.questionRepo.count({
      where: { game: { id: gameId } },
    });
    const question = this.questionRepo.create({
      game,
      order,
      questionText: dto.questionText,
      options: dto.options,
      correctOptionIndex: dto.correctOptionIndex,
      points: dto.points ?? 1000,
      timeLimitSeconds: dto.timeLimitSeconds ?? 20,
    });
    const saved = await this.questionRepo.save(question);
    this.auditLogService.log('GAME_QUESTION_ADDED', {
      actorId: admin.id,
      targetId: saved.id,
      targetName: game.title,
      metadata: { gameId },
    });
    return saved;
  }

  async updateQuestion(
    questionId: string,
    dto: UpdateGameQuestionDto,
    admin: Admin,
  ): Promise<GameQuestion> {
    const question = await this.getQuestionOrThrow(questionId);
    const options = dto.options ?? question.options;
    const correctOptionIndex =
      dto.correctOptionIndex ?? question.correctOptionIndex;
    this.assertValidCorrectIndex(options, correctOptionIndex);

    if (dto.questionText !== undefined)
      question.questionText = dto.questionText;
    if (dto.options !== undefined) question.options = dto.options;
    if (dto.correctOptionIndex !== undefined)
      question.correctOptionIndex = dto.correctOptionIndex;
    if (dto.points !== undefined) question.points = dto.points;
    if (dto.timeLimitSeconds !== undefined)
      question.timeLimitSeconds = dto.timeLimitSeconds;

    const saved = await this.questionRepo.save(question);
    this.auditLogService.log('GAME_QUESTION_UPDATED', {
      actorId: admin.id,
      targetId: questionId,
      targetName: question.game.title,
      metadata: { changes: Object.keys(dto) },
    });
    return saved;
  }

  async deleteQuestion(questionId: string, admin: Admin): Promise<void> {
    const question = await this.getQuestionOrThrow(questionId);
    await this.questionRepo.remove(question);
    this.auditLogService.log('GAME_QUESTION_DELETED', {
      actorId: admin.id,
      targetId: questionId,
      targetName: question.game.title,
    });
  }

  async listQuestions(gameId: string): Promise<GameQuestion[]> {
    return this.questionRepo.find({
      where: { game: { id: gameId } },
      order: { order: 'ASC' },
    });
  }

  async reorderQuestions(
    gameId: string,
    dto: ReorderQuestionsDto,
    admin: Admin,
  ): Promise<GameQuestion[]> {
    const game = await this.getGameOrThrow(gameId);
    const questions = await this.listQuestions(gameId);
    const byId = new Map(questions.map((q) => [q.id, q]));
    if (
      dto.questionIds.length !== questions.length ||
      !dto.questionIds.every((id) => byId.has(id))
    ) {
      throw new BadRequestException(
        "questionIds must contain exactly the game's current question ids",
      );
    }

    await Promise.all(
      dto.questionIds.map((id, index) =>
        this.questionRepo.update(id, { order: index }),
      ),
    );
    this.auditLogService.log('GAME_QUESTIONS_REORDERED', {
      actorId: admin.id,
      targetId: gameId,
      targetName: game.title,
    });
    return this.listQuestions(gameId);
  }

  // ─── Session lifecycle (admin) ───────────────────────────────────────────

  async startSession(gameId: string, admin: Admin): Promise<GameSession> {
    const game = await this.getGameOrThrow(gameId);
    const questionCount = await this.questionRepo.count({
      where: { game: { id: gameId } },
    });
    if (questionCount === 0) {
      throw new BadRequestException(
        'Add at least one question before starting a session',
      );
    }

    const existingLive = await this.sessionRepo.findOne({
      where: { game: { id: gameId }, status: GameSessionStatusEnum.LIVE },
    });
    if (existingLive) {
      throw new BadRequestException(
        `A live session (${existingLive.sessionCode}) is already running for this game — resume or end it before starting a new one`,
      );
    }

    // currentQuestionIndex/currentQuestionStartedAt start null, not 0/now —
    // this is the lobby: members can join and see the code, but no
    // question's timer starts ticking until the host explicitly reveals
    // Question 1 via nextQuestion (its `?? -1) + 1` already yields 0 from
    // null with no other change needed). Previously these were set
    // immediately, so Question 1's clock started the instant this returned
    // — before any member could possibly have joined.
    const session = this.sessionRepo.create({
      game,
      sessionCode: this.generateSessionCode(),
      status: GameSessionStatusEnum.LIVE,
      hostAdmin: admin,
      currentQuestionIndex: null,
      currentQuestionStartedAt: null,
      startedAt: new Date(),
    });
    const saved = await this.sessionRepo.save(session);

    game.status = GameStatusEnum.LIVE_SESSION_ACTIVE;
    await this.gameRepo.save(game);

    this.auditLogService.log('GAME_SESSION_STARTED', {
      actorId: admin.id,
      targetId: saved.id,
      targetName: game.title,
      metadata: { gameId, sessionCode: saved.sessionCode },
    });
    return saved;
  }

  async nextQuestion(
    sessionCode: string,
    admin: Admin,
  ): Promise<GameSessionStatePayload> {
    const session = await this.getSessionOrThrow(sessionCode);
    this.assertIsHost(session, admin);
    this.assertSessionLive(session);

    const totalQuestions = await this.questionRepo.count({
      where: { game: { id: session.game.id } },
    });
    const nextIndex = (session.currentQuestionIndex ?? -1) + 1;
    if (nextIndex >= totalQuestions) {
      throw new BadRequestException(
        'No more questions — end the session instead',
      );
    }

    session.currentQuestionIndex = nextIndex;
    session.currentQuestionStartedAt = new Date();
    await this.sessionRepo.save(session);

    return this.getSessionState(sessionCode);
  }

  // Deliberately NOT host-restricted, unlike nextQuestion — ending is the
  // safety valve for a session whose host closed their tab without ending
  // it themselves (the only way to clear a game stuck LIVE, since
  // startSession blocks starting a new one while any session is still
  // live). "Two admins driving the same live game" is a real conflict
  // worth blocking on nextQuestion; a second admin cleaning up an
  // abandoned session is exactly the case this needs to allow. The
  // controller guard already requires GAMES_WRITE; who actually ended it
  // stays traceable via the audit log below regardless of whether they
  // were the original host.
  async endSession(
    sessionCode: string,
    admin: Admin,
  ): Promise<GameSessionStatePayload> {
    const session = await this.getSessionOrThrow(sessionCode);
    if (session.status !== GameSessionStatusEnum.ENDED) {
      session.status = GameSessionStatusEnum.ENDED;
      session.endedAt = new Date();
      await this.sessionRepo.save(session);

      // Only clear the game back to DRAFT if this was the last LIVE session
      // for it — with the duplicate-session guard in startSession, that's
      // normally guaranteed, but this stays defensive against any session
      // left LIVE from before that guard existed (or a future bypass of it),
      // which would otherwise let this overwrite a still-genuinely-live game
      // back to DRAFT under it.
      const stillLive = await this.sessionRepo.findOne({
        where: {
          game: { id: session.game.id },
          status: GameSessionStatusEnum.LIVE,
        },
      });
      if (!stillLive) {
        session.game.status = GameStatusEnum.DRAFT;
        await this.gameRepo.save(session.game);
      }

      this.auditLogService.log('GAME_SESSION_ENDED', {
        actorId: admin.id,
        targetId: session.id,
        targetName: session.game.title,
        metadata: { sessionCode },
      });
    }
    return this.getSessionState(sessionCode);
  }

  // ─── Participant ──────────────────────────────────────────────────────────

  async joinSession(
    sessionCode: string,
    memberId: string,
  ): Promise<{ participantId: string }> {
    const session = await this.getSessionOrThrow(sessionCode);
    if (session.status !== GameSessionStatusEnum.LIVE) {
      throw new BadRequestException('This game session is not currently live');
    }

    let participant = await this.participantRepo.findOne({
      where: { session: { id: session.id }, member: { id: memberId } },
    });
    if (!participant) {
      participant = this.participantRepo.create({
        session,
        member: { id: memberId } as any,
        totalScore: 0,
      });
      participant = await this.participantRepo.save(participant);
    }
    return { participantId: participant.id };
  }

  async submitAnswer(
    sessionCode: string,
    questionId: string,
    memberId: string,
    dto: SubmitAnswerDto,
  ): Promise<{ isCorrect: boolean; pointsAwarded: number }> {
    const session = await this.getSessionOrThrow(sessionCode);
    this.assertSessionLive(session);

    const currentQuestion = await this.getCurrentQuestionOrThrow(session);
    if (currentQuestion.id !== questionId) {
      throw new BadRequestException('This is not the current question');
    }
    if (session.currentQuestionStartedAt) {
      const elapsedSeconds =
        (Date.now() - session.currentQuestionStartedAt.getTime()) / 1000;
      if (
        elapsedSeconds >
        currentQuestion.timeLimitSeconds + ANSWER_GRACE_SECONDS
      ) {
        throw new BadRequestException('Time is up for this question');
      }
    }

    const participant = await this.participantRepo.findOne({
      where: { session: { id: session.id }, member: { id: memberId } },
    });
    if (!participant) {
      throw new ForbiddenException('Join the session before answering');
    }

    const existing = await this.responseRepo.findOne({
      where: {
        session: { id: session.id },
        question: { id: questionId },
        participant: { id: participant.id },
      },
    });
    if (existing) {
      throw new BadRequestException('You have already answered this question');
    }

    const isCorrect =
      dto.selectedOptionIndex === currentQuestion.correctOptionIndex;
    const pointsAwarded = isCorrect
      ? this.computeScore(currentQuestion, session.currentQuestionStartedAt)
      : 0;

    const response = this.responseRepo.create({
      session,
      question: currentQuestion,
      participant,
      selectedOptionIndex: dto.selectedOptionIndex,
      isCorrect,
      pointsAwarded,
      answeredAt: new Date(),
    });
    try {
      await this.responseRepo.save(response);
    } catch (err: unknown) {
      // The findOne check above leaves a race window under a concurrent
      // double-submit — the unique constraint on (session, question,
      // participant) still catches it, so surface the same 400 rather than
      // letting a raw DB conflict bubble up as a 500.
      if ((err as { code?: string })?.code === '23505') {
        throw new BadRequestException(
          'You have already answered this question',
        );
      }
      throw err;
    }

    if (pointsAwarded > 0) {
      participant.totalScore += pointsAwarded;
      await this.participantRepo.save(participant);
    }

    return { isCorrect, pointsAwarded };
  }

  // Never includes correctOptionIndex — this payload is broadcast verbatim
  // to every participant in the session's socket room, so the answer must
  // never travel through it. The admin presenter view already has the full
  // question (with the answer) from its own question-list fetch.
  async getSessionState(sessionCode: string): Promise<GameSessionStatePayload> {
    const session = await this.getSessionOrThrow(sessionCode);
    const questions = await this.listQuestions(session.game.id);
    const currentQuestion =
      session.currentQuestionIndex !== null
        ? (questions[session.currentQuestionIndex] ?? null)
        : null;

    const [participantCount, answeredCount, leaderboard] = await Promise.all([
      this.participantRepo.count({ where: { session: { id: session.id } } }),
      currentQuestion
        ? this.responseRepo.count({
            where: {
              session: { id: session.id },
              question: { id: currentQuestion.id },
            },
          })
        : Promise.resolve(0),
      this.getLeaderboard(sessionCode),
    ]);

    let secondsRemaining: number | null = null;
    if (currentQuestion && session.currentQuestionStartedAt) {
      const elapsedSeconds =
        (Date.now() - session.currentQuestionStartedAt.getTime()) / 1000;
      secondsRemaining = Math.max(
        0,
        Math.ceil(currentQuestion.timeLimitSeconds - elapsedSeconds),
      );
    }

    return {
      sessionCode: session.sessionCode,
      gameTitle: session.game.title,
      status: session.status,
      currentQuestionIndex: session.currentQuestionIndex,
      totalQuestions: questions.length,
      currentQuestion: currentQuestion
        ? this.toPublicQuestion(currentQuestion)
        : null,
      currentQuestionStartedAt: currentQuestion
        ? (session.currentQuestionStartedAt?.getTime() ?? null)
        : null,
      secondsRemaining,
      answeredCount,
      participantCount,
      leaderboard,
    };
  }

  async getLeaderboard(sessionCode: string): Promise<LeaderboardEntry[]> {
    const session = await this.getSessionOrThrow(sessionCode);
    const participants = await this.participantRepo.find({
      where: { session: { id: session.id } },
      relations: ['member'],
      // createdAt as the tie-break — without it, equal scores have no
      // deterministic order and the leaderboard (and "who's #1") could
      // flicker between requests. Matches the DISTINCT ON ordering
      // listGameSessions uses for the same reason.
      order: { totalScore: 'DESC', createdAt: 'ASC' },
    });
    return participants.map((p) => ({
      participantId: p.id,
      memberId: p.member.id,
      memberName: `${p.member.firstname} ${p.member.lastname}`,
      totalScore: p.totalScore,
    }));
  }

  // Only ENDED sessions count as history — a mid-flight LIVE score isn't
  // a result yet, and showing a rank for it would be meaningless (it can
  // still change).
  async getMyGameHistory(
    memberId: string,
    page = 1,
    limit = 10,
  ): Promise<PaginationResponseDto<MyGameHistoryEntry>> {
    const [participations, total] = await this.participantRepo
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.session', 'session')
      .innerJoinAndSelect('session.game', 'game')
      .where('p.member_id = :memberId', { memberId })
      .andWhere('session.status = :ended', {
        ended: GameSessionStatusEnum.ENDED,
      })
      .orderBy('session.startedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    if (participations.length === 0) {
      return UtilityService.createPaginationResponse([], page, limit, total);
    }

    const sessionIds = participations.map((p) => p.session.id);
    const participantIds = participations.map((p) => p.id);

    // Rank/participantCount need a window over EVERY participant in each
    // session, not just this member's own row — the member filter has to
    // sit outside the window (in the outer WHERE), or RANK() would see a
    // single row per partition and always return 1. Raw query through the
    // request's own search_path, same idiom
    // ServiceSessionService.getMyServiceHistory already uses for its own
    // membership subquery. RANK(), not ROW_NUMBER() — tied scores must
    // share a rank rather than being arbitrarily split.
    const rankRows: {
      session_id: string;
      rank: string;
      participant_count: string;
    }[] = await this.participantRepo.query(
      `SELECT r.session_id, r.rank, r.participant_count FROM (
           SELECT gp.session_id, gp.member_id,
                  RANK() OVER (PARTITION BY gp.session_id ORDER BY gp.total_score DESC) AS rank,
                  COUNT(*) OVER (PARTITION BY gp.session_id) AS participant_count
           FROM game_participants gp
           WHERE gp.session_id = ANY($1)
         ) r WHERE r.member_id = $2`,
      [sessionIds, memberId],
    );
    const rankBySessionId = new Map(
      rankRows.map((r) => [
        r.session_id,
        { rank: Number(r.rank), participantCount: Number(r.participant_count) },
      ]),
    );

    const responseCountRows = await this.responseRepo
      .createQueryBuilder('r')
      .select('r.participant_id', 'participantId')
      .addSelect('COUNT(*)::int', 'answered')
      .addSelect('COUNT(*) FILTER (WHERE r.is_correct)::int', 'correct')
      .where('r.participant_id IN (:...participantIds)', { participantIds })
      .groupBy('r.participant_id')
      .getRawMany<{
        participantId: string;
        answered: number;
        correct: number;
      }>();
    const responseCountsByParticipantId = new Map(
      responseCountRows.map((r) => [
        r.participantId,
        { answered: r.answered, correct: r.correct },
      ]),
    );

    const data: MyGameHistoryEntry[] = participations.map((p) => ({
      sessionCode: p.session.sessionCode,
      gameTitle: p.session.game.title,
      playedAt: p.session.startedAt,
      totalScore: p.totalScore,
      rank: rankBySessionId.get(p.session.id)?.rank ?? 1,
      participantCount:
        rankBySessionId.get(p.session.id)?.participantCount ?? 1,
      correctCount: responseCountsByParticipantId.get(p.id)?.correct ?? 0,
      answeredCount: responseCountsByParticipantId.get(p.id)?.answered ?? 0,
    }));

    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  // Lets the admin games list/detail surface a "Resume" action for a game
  // that has a LIVE session, without the admin having to remember or
  // re-copy the join code from wherever they started it, and a play count
  // so "Draft" isn't the only signal the list ever shows. Deliberately
  // queries GameSession directly for every game in the batch rather than
  // trusting Game.status — Game.status is a redundant, denormalized mirror
  // of "is there a live session", and can drift out of sync with the real
  // source of truth (e.g. a session left LIVE from before startSession's
  // duplicate-session guard existed). Sourcing this from GameSession itself
  // means the UI stays correct even if Game.status is wrong.
  private async attachActiveSessionCodes(
    games: Game[],
  ): Promise<GameListItem[]> {
    if (games.length === 0) return [];
    const gameIds = games.map((g) => g.id);

    const [liveSessions, playCountRows] = await Promise.all([
      this.sessionRepo.find({
        where: {
          game: { id: In(gameIds) },
          status: GameSessionStatusEnum.LIVE,
        },
        relations: ['game'],
      }),
      this.sessionRepo
        .createQueryBuilder('s')
        .select('s.game_id', 'gameId')
        .addSelect('COUNT(*)::int', 'count')
        .where('s.game_id IN (:...gameIds)', { gameIds })
        .andWhere('s.status = :ended', { ended: GameSessionStatusEnum.ENDED })
        .groupBy('s.game_id')
        .getRawMany<{ gameId: string; count: number }>(),
    ]);

    const codeByGameId = new Map<string, string>();
    liveSessions.forEach((s) => codeByGameId.set(s.game.id, s.sessionCode));
    const playCountByGameId = new Map(
      playCountRows.map((r) => [r.gameId, Number(r.count)]),
    );

    return games.map((g) => ({
      ...g,
      activeSessionCode: codeByGameId.get(g.id) ?? null,
      playCount: playCountByGameId.get(g.id) ?? 0,
    }));
  }

  private toPublicQuestion(question: GameQuestion): PublicGameQuestion {
    return {
      id: question.id,
      order: question.order,
      questionText: question.questionText,
      options: question.options,
      timeLimitSeconds: question.timeLimitSeconds,
      points: question.points,
    };
  }

  private computeScore(question: GameQuestion, startedAt: Date | null): number {
    if (!startedAt) return question.points;
    const elapsedSeconds = (Date.now() - startedAt.getTime()) / 1000;
    const remainingFraction = Math.max(
      0,
      1 - elapsedSeconds / question.timeLimitSeconds,
    );
    const speedFraction = Math.max(MIN_SPEED_BONUS_FRACTION, remainingFraction);
    return Math.round(question.points * speedFraction);
  }

  private assertValidCorrectIndex(
    options: string[],
    correctOptionIndex: number,
  ): void {
    if (correctOptionIndex < 0 || correctOptionIndex >= options.length) {
      throw new BadRequestException(
        'correctOptionIndex must be a valid index into options',
      );
    }
  }

  private assertIsHost(session: GameSession, admin: Admin): void {
    if (session.hostAdmin && session.hostAdmin.id !== admin.id) {
      throw new ForbiddenException(
        'Only the session host can control this session',
      );
    }
  }

  private assertSessionLive(session: GameSession): void {
    if (session.status !== GameSessionStatusEnum.LIVE) {
      throw new BadRequestException('This game session is not currently live');
    }
  }

  private async getCurrentQuestionOrThrow(
    session: GameSession,
  ): Promise<GameQuestion> {
    if (session.currentQuestionIndex === null) {
      throw new BadRequestException('No question is currently active');
    }
    const questions = await this.listQuestions(session.game.id);
    const question = questions[session.currentQuestionIndex];
    if (!question) throw new NotFoundException('Current question not found');
    return question;
  }

  private generateSessionCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const suffix = Array.from(
      { length: 6 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join('');
    return `GAME-${suffix}`;
  }

  private async getGameOrThrow(id: string): Promise<Game> {
    const game = await this.gameRepo.findOne({
      where: { id },
      relations: ['department', 'churchClass'],
    });
    if (!game) throw new NotFoundException('Game not found');
    return game;
  }

  private async getQuestionOrThrow(id: string): Promise<GameQuestion> {
    const question = await this.questionRepo.findOne({
      where: { id },
      relations: ['game'],
    });
    if (!question) throw new NotFoundException('Question not found');
    return question;
  }

  private async getSessionOrThrow(sessionCode: string): Promise<GameSession> {
    const session = await this.sessionRepo.findOne({
      where: { sessionCode },
      relations: ['game', 'hostAdmin'],
    });
    if (!session) throw new NotFoundException('Game session not found');
    return session;
  }
}
