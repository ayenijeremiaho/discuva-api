import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { startOfMonth } from 'date-fns';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import {
  BibleCharacterDuel,
  DuelStatus,
  OPEN_DUEL_STATUSES,
} from '../entity/bible-character-duel.entity';
import {
  BibleCharacter,
  Difficulty,
  QUESTION,
  answer,
  characterData,
  maskNames,
  matchTerms,
} from '../engine/characters';
import {
  DAILY_SCORED_GAMES,
  MAX_WRONG_GUESSES,
  stillPossible,
  SUGGESTED_QUESTIONS,
  candidates,
  questionLimitReached,
  MAX_QUESTIONS,
  withOwn,
  possibleNames,
  usefulQuestions,
  worthNow,
} from '../engine/character-game';
import {
  DuelReason,
  DuelSide,
  DuelSideState,
  DuelWinner,
  FIRST_MOVER,
  MAX_OPEN_DUELS,
  afterMove,
  duelPoints,
  otherSide,
} from '../engine/duel';
import { label, verse } from '../engine/bible';
import { RevealedCharacter, cluesFor, revealCharacter } from '../engine/reveal';
import { BibleCharactersService } from './bible-characters.service';
import { BibleCharacterGameService } from './bible-character-game.service';
import { BibleGamesService } from './bible-games.service';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';

const LEVEL: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};
const RECENT_FINISHED = 10;
const OPPONENT_RESULTS = 20;

export interface Player {
  id: string;
  name: string;
  photoUrl?: string | null;
}

export interface DuelAsked {
  questionId: string;
  text: string;
  answer: boolean;
}

export interface DuelView {
  id: string;
  difficulty: Difficulty;
  status: DuelStatus;
  you: DuelSide;
  opponent: Player;
  yourTurn: boolean;
  finalTurn: boolean;
  turnNumber: number;
  turnDeadline: string | null;
  me: {
    asked: DuelAsked[];
    hints: { label: string; text: string }[];
    hintsLeft: number;
    wrongGuesses: { id: string; name: string }[];
    guessesLeft: number;
    stillPossible: number;
    questionsLeft: number;
    suggestions: string[];
    usefulQuestions: string[];
    possibleNames: { id: string; name: string }[] | null;
    worth: number;
  } | null;
  // The other player's questions are about their own character, so they give nothing of yours away.
  them: {
    asked: DuelAsked[];
    hints: number;
    wrongGuesses: number;
    guessesLeft: number;
    stillPossible: number;
  } | null;
  result: {
    outcome: 'won' | 'lost' | 'draw';
    reason: DuelReason;
    points: number;
    scored: boolean;
    yours: RevealedCharacter;
    theirs: RevealedCharacter;
  } | null;
  createdAt: string;
}

export interface DuelSummary {
  id: string;
  difficulty: Difficulty;
  status: DuelStatus;
  you: DuelSide;
  opponent: Player;
  yourTurn: boolean;
  finalTurn: boolean;
  turnDeadline: string | null;
  outcome: 'won' | 'lost' | 'draw' | null;
  points: number;
  createdAt: string;
}

// Guess the Bible Character, Duel: two members of the same church, each with their own character, taking turns.
@Injectable()
export class BibleCharacterDuelService {
  private readonly logger = new Logger(BibleCharacterDuelService.name);

  constructor(
    @InjectRepository(BibleCharacterDuel)
    private readonly duelRepo: Repository<BibleCharacterDuel>,
    private readonly characters: BibleCharactersService,
    private readonly game: BibleCharacterGameService,
    private readonly bibleGames: BibleGamesService,
    private readonly push: PushNotificationService,
    private readonly churchTimezone: ChurchTimezoneService,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async list(memberId: string) {
    await this.expireOverdue(memberId);
    const where = [{ challengerId: memberId }, { opponentId: memberId }];
    const [open, finished, settings] = await Promise.all([
      this.duelRepo.find({
        where: where.map((w) => ({ ...w, status: In(OPEN_DUEL_STATUSES) })),
        order: { createdAt: 'DESC' },
      }),
      this.duelRepo.find({
        where: where.map((w) => ({
          ...w,
          status: In([
            DuelStatus.FINISHED,
            DuelStatus.DECLINED,
            DuelStatus.CANCELLED,
            DuelStatus.EXPIRED,
          ]),
        })),
        order: { createdAt: 'DESC' },
        take: RECENT_FINISHED,
      }),
      this.characters.settings(),
    ]);
    const duels = [...open, ...finished];
    const names = await this.names(
      duels.flatMap((d) => [d.challengerId, d.opponentId]),
    );
    return {
      duels: duels.map((d) => this.summary(d, memberId, names)),
      openCount: open.length,
      maxOpen: MAX_OPEN_DUELS,
      turnHours: settings.turnHours,
    };
  }

  // Active members to challenge; each word must match a first or last name (trigram-indexed).
  async opponents(memberId: string, search: string): Promise<Player[]> {
    const words = search.trim().split(/\s+/).filter(Boolean).slice(0, 3);
    if (!words.length) return [];
    const params: unknown[] = [memberId];
    const conditions = words.map((w) => {
      params.push(`%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      const p = `$${params.length}`;
      return `(m.firstname ILIKE ${p} OR m.lastname ILIKE ${p})`;
    });
    const rows = (await this.txHost.tx.query(
      `SELECT m.id, m.firstname, m.lastname, m.photo_url FROM members m
       WHERE m.status = 'ACTIVE' AND m.id <> $1 AND ${conditions.join(' AND ')}
       ORDER BY m.firstname, m.lastname
       LIMIT ${OPPONENT_RESULTS}`,
      params,
    )) as {
      id: string;
      firstname: string;
      lastname: string;
      photo_url: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      name: fullName(r),
      photoUrl: r.photo_url,
    }));
  }

  async invite(
    memberId: string,
    opponentId: string,
    difficulty: Difficulty,
  ): Promise<DuelView> {
    if (opponentId === memberId)
      throw new BadRequestException("You can't challenge yourself.");
    const opponent = (await this.txHost.tx.query(
      `SELECT id FROM members WHERE id = $1 AND status = 'ACTIVE'`,
      [opponentId],
    )) as { id: string }[];
    if (!opponent.length) throw new NotFoundException('Member not found');
    const pool = await this.characters.playable();
    if (pool.filter((c) => c.difficulty === difficulty).length < 2)
      throw new ConflictException({
        code: 'NO_CHARACTERS',
        message: 'There are not enough characters at this level yet.',
      });
    await this.expireOverdue(memberId);
    await this.expireOverdue(opponentId);
    const [mine, theirs, between] = await Promise.all([
      this.openCount(memberId),
      this.openCount(opponentId),
      this.duelRepo.count({
        where: [
          {
            challengerId: memberId,
            opponentId,
            status: In(OPEN_DUEL_STATUSES),
          },
          {
            challengerId: opponentId,
            opponentId: memberId,
            status: In(OPEN_DUEL_STATUSES),
          },
        ],
      }),
    ]);
    if (between)
      throw new ConflictException({
        code: 'DUEL_EXISTS',
        message: 'You already have a duel with them. Finish that one first.',
      });
    if (mine >= MAX_OPEN_DUELS)
      throw new ConflictException({
        code: 'TOO_MANY_DUELS',
        message: `You can have ${MAX_OPEN_DUELS} duels going at once. Finish one first.`,
      });
    if (theirs >= MAX_OPEN_DUELS)
      throw new ConflictException({
        code: 'OPPONENT_BUSY',
        message: 'They have too many duels going right now. Try again later.',
      });
    const { turnHours } = await this.characters.settings();
    const duel = await this.duelRepo.save(
      this.duelRepo.create({
        challengerId: memberId,
        opponentId,
        difficulty,
        status: DuelStatus.INVITED,
        turnDeadline: this.deadline(turnHours),
      }),
    );
    const names = await this.names([memberId, opponentId]);
    this.notify(opponentId, PushNotificationKey.BIBLE_DUEL_INVITE, duel, {
      player_name: names.get(memberId),
      level: LEVEL[difficulty],
      hours: turnHours,
    });
    return this.view(duel, memberId, pool, names);
  }

  async get(memberId: string, id: string): Promise<DuelView> {
    const duel = await this.lock(memberId, id);
    await this.timeOutIfOverdue(duel);
    return this.view(duel, memberId);
  }

  async accept(memberId: string, id: string): Promise<DuelView> {
    const duel = await this.lock(memberId, id);
    if (await this.timeOutIfOverdue(duel)) return this.view(duel, memberId);
    if (duel.status !== DuelStatus.INVITED || duel.opponentId !== memberId)
      throw new ConflictException({
        code: 'NOT_AN_INVITE',
        message: 'This duel is not waiting for you to accept.',
      });
    await this.notInService(memberId);
    const pool = await this.characters.playable();
    const choices = pool.filter((c) => c.difficulty === duel.difficulty);
    if (choices.length < 2)
      throw new ConflictException({
        code: 'NO_CHARACTERS',
        message: 'There are not enough characters at this level yet.',
      });
    const first = Math.floor(Math.random() * choices.length);
    let second = Math.floor(Math.random() * (choices.length - 1));
    if (second >= first) second += 1;
    duel.challengerCharacter = choices[first].id;
    duel.opponentCharacter = choices[second].id;
    duel.status = DuelStatus.ACTIVE;
    duel.turn = FIRST_MOVER;
    duel.turnDeadline = this.deadline(
      (await this.characters.settings()).turnHours,
    );
    await this.duelRepo.save(duel);
    return this.view(duel, memberId, pool);
  }

  // The person invited declines; the challenger cancels before it's accepted.
  async decline(memberId: string, id: string): Promise<DuelView> {
    const duel = await this.lock(memberId, id);
    if (await this.timeOutIfOverdue(duel)) return this.view(duel, memberId);
    if (duel.status !== DuelStatus.INVITED)
      throw new ConflictException({
        code: 'NOT_AN_INVITE',
        message: 'This duel has already started.',
      });
    duel.status =
      duel.opponentId === memberId ? DuelStatus.DECLINED : DuelStatus.CANCELLED;
    duel.turnDeadline = null;
    duel.finishedAt = new Date();
    await this.duelRepo.save(duel);
    return this.view(duel, memberId);
  }

  async ask(
    memberId: string,
    id: string,
    questionId: string,
  ): Promise<DuelView> {
    return this.move(memberId, id, (duel, side, state, character) => {
      if (duel.finalTurn) throw lastGuessOnly();
      if (!QUESTION.has(questionId))
        throw new BadRequestException('Unknown question');
      if (state.asked.some((a) => a.q === questionId))
        throw new ConflictException({
          code: 'ALREADY_ASKED',
          message: 'You have already asked that.',
        });
      if (state.asked.length >= MAX_QUESTIONS)
        throw new ConflictException(questionLimitReached());
      state.asked = [
        ...state.asked,
        { q: questionId, a: answer(questionId, character) },
      ];
      return 'move';
    });
  }

  async hint(memberId: string, id: string): Promise<DuelView> {
    const pool = await this.characters.playable();
    return this.move(memberId, id, (duel, side, state, character) => {
      if (duel.finalTurn) throw lastGuessOnly();
      if (state.hints >= cluesFor(character, pool).length)
        throw new ConflictException({
          code: 'NO_HINTS_LEFT',
          message: 'There are no more hints for this character.',
        });
      state.hints += 1;
      return 'move';
    });
  }

  async guess(
    memberId: string,
    id: string,
    characterId: string,
  ): Promise<DuelView> {
    if (!characterData().byId.has(characterId))
      throw new BadRequestException('Unknown character');
    return this.move(memberId, id, (duel, side, state, character) => {
      if (state.wrong.includes(characterId))
        throw new ConflictException({
          code: 'ALREADY_GUESSED',
          message: 'You have already guessed them.',
        });
      if (characterId === character.id) return 'found';
      state.wrong = [...state.wrong, characterId];
      return state.wrong.length >= MAX_WRONG_GUESSES ? 'out' : 'move';
    });
  }

  // Either player can resign at any point; the other wins.
  async resign(memberId: string, id: string): Promise<DuelView> {
    const duel = await this.lock(memberId, id);
    if (await this.timeOutIfOverdue(duel)) return this.view(duel, memberId);
    if (duel.status !== DuelStatus.ACTIVE) throw duelOver();
    await this.finish(duel, otherSide(this.sideOf(duel, memberId)), 'resigned');
    return this.view(duel, memberId);
  }

  // Invites not accepted and turns not taken in time. Called for one member before reading their duels,
  // and for everyone by the hourly sweep.
  async expireOverdue(memberId?: string): Promise<number> {
    const params: unknown[] = [];
    let who = '';
    if (memberId) {
      params.push(memberId);
      who = 'AND (challenger_id = $1 OR opponent_id = $1)';
    }
    const rows = (await this.txHost.tx.query(
      `SELECT id FROM bible_character_duels
       WHERE status IN ('invited', 'active') AND turn_deadline < now() ${who}
       ORDER BY turn_deadline
       LIMIT 200
       FOR UPDATE SKIP LOCKED`,
      params,
    )) as { id: string }[];
    if (!rows.length) return 0;
    const duels = await this.duelRepo.find({
      where: { id: In(rows.map((r) => r.id)) },
    });
    for (const duel of duels) await this.timeOutIfOverdue(duel);
    return duels.length;
  }

  async adminStats() {
    const timezone = await this.churchTimezone.get();
    const monthStart = fromZonedTime(
      startOfMonth(toZonedTime(new Date(), timezone)),
      timezone,
    );
    const rows = (await this.txHost.tx.query(
      `SELECT (SELECT COUNT(*) FROM bible_character_duels
                WHERE status = 'finished' AND finished_at >= $1)::int AS finished,
              (SELECT COUNT(*) FROM bible_character_duels
                WHERE status IN ('invited', 'active') AND turn_deadline IS NOT NULL)::int AS open`,
      [monthStart],
    )) as { finished: number; open: number }[];
    return {
      finishedThisMonth: rows[0]?.finished ?? 0,
      inPlay: rows[0]?.open ?? 0,
    };
  }

  private async move(
    memberId: string,
    id: string,
    play: (
      duel: BibleCharacterDuel,
      side: DuelSide,
      state: DuelSideState,
      character: BibleCharacter,
    ) => 'move' | 'found' | 'out',
  ): Promise<DuelView> {
    const duel = await this.lock(memberId, id);
    if (await this.timeOutIfOverdue(duel)) return this.view(duel, memberId);
    if (duel.status !== DuelStatus.ACTIVE) throw duelOver();
    const side = this.sideOf(duel, memberId);
    if (duel.turn !== side)
      throw new ConflictException({
        code: 'NOT_YOUR_TURN',
        message: "It's their turn. We'll let you know when it's yours.",
      });
    await this.notInService(memberId);
    const state = { ...this.stateOf(duel, side) };
    const event = play(duel, side, state, this.characterOf(duel, side));
    if (side === 'challenger') duel.challengerState = state;
    else duel.opponentState = state;
    duel.turnNumber += 1;
    const outcome = afterMove(side, duel.finalTurn, event);
    if (outcome.kind === 'finished') {
      await this.finish(duel, outcome.winner, outcome.reason);
    } else {
      const { turnHours } = await this.characters.settings();
      duel.turn = outcome.turn;
      duel.finalTurn = outcome.finalTurn;
      duel.turnDeadline = this.deadline(turnHours);
      await this.duelRepo.save(duel);
      const next = this.memberOf(duel, outcome.turn);
      const names = await this.names([memberId]);
      this.notify(next, PushNotificationKey.BIBLE_DUEL_YOUR_TURN, duel, {
        player_name: names.get(memberId),
        hours: turnHours,
      });
    }
    return this.view(duel, memberId);
  }

  // True when the duel had run out of time and is now over.
  private async timeOutIfOverdue(duel: BibleCharacterDuel): Promise<boolean> {
    if (
      !OPEN_DUEL_STATUSES.includes(duel.status) ||
      !duel.turnDeadline ||
      duel.turnDeadline.getTime() > Date.now()
    )
      return false;
    if (duel.status === DuelStatus.INVITED) {
      duel.status = DuelStatus.EXPIRED;
      duel.turnDeadline = null;
      duel.finishedAt = new Date();
      await this.duelRepo.save(duel);
      return true;
    }
    const late = duel.turn ?? FIRST_MOVER;
    // Missing the last guess leaves the first mover's find standing.
    await this.finish(
      duel,
      otherSide(late),
      duel.finalTurn ? 'found' : 'timeout',
    );
    return true;
  }

  private async finish(
    duel: BibleCharacterDuel,
    winner: DuelWinner,
    reason: DuelReason,
  ): Promise<void> {
    duel.status = DuelStatus.FINISHED;
    duel.winner = winner;
    duel.reason = reason;
    duel.turn = null;
    duel.turnDeadline = null;
    duel.finalTurn = false;
    duel.finishedAt = new Date();
    const awards: { memberId: string; points: number; found: boolean }[] = [];
    for (const side of ['challenger', 'opponent'] as DuelSide[]) {
      const won = winner === side || winner === 'draw';
      if (!won) continue;
      const found = winner === 'draw' || reason === 'found';
      const memberId = this.memberOf(duel, side);
      const points = duelPoints(
        duel.difficulty,
        this.stateOf(duel, side),
        found,
      );
      const scored =
        (await this.game.scoredToday(memberId)) < DAILY_SCORED_GAMES;
      if (side === 'challenger') {
        duel.challengerPoints = points;
        duel.challengerScored = scored;
      } else {
        duel.opponentPoints = points;
        duel.opponentScored = scored;
      }
      if (scored) awards.push({ memberId, points, found });
    }
    await this.duelRepo.save(duel);
    for (const a of awards)
      await this.bibleGames.awardPoints(
        a.memberId,
        'characters',
        a.points,
        a.found ? 1 : 0,
      );
    const names = await this.names([duel.challengerId, duel.opponentId]);
    for (const side of ['challenger', 'opponent'] as DuelSide[]) {
      const me = this.memberOf(duel, side);
      const outcome =
        winner === 'draw'
          ? "it's a draw!"
          : winner === side
            ? 'you won!'
            : 'they won this time.';
      this.notify(me, PushNotificationKey.BIBLE_DUEL_FINISHED, duel, {
        player_name: names.get(this.memberOf(duel, otherSide(side))),
        outcome,
      });
    }
  }

  private async view(
    duel: BibleCharacterDuel,
    memberId: string,
    pool?: BibleCharacter[],
    names?: Map<string, string>,
  ): Promise<DuelView> {
    const playable = pool ?? (await this.characters.playable());
    const players =
      names ?? (await this.names([duel.challengerId, duel.opponentId]));
    const you = this.sideOf(duel, memberId);
    const them = otherSide(you);
    const started = !!duel.challengerCharacter && !!duel.opponentCharacter;
    const { byId } = characterData();
    const atLevel = playable.filter((c) => c.difficulty === duel.difficulty);
    const asked = (s: DuelSideState): DuelAsked[] =>
      s.asked.map((a) => ({
        questionId: a.q,
        text: QUESTION.get(a.q)?.text ?? a.q,
        answer: a.a,
      }));
    const mine = this.stateOf(duel, you);
    const theirs = this.stateOf(duel, them);
    const finished = duel.status === DuelStatus.FINISHED;
    let me: DuelView['me'] = null;
    if (started) {
      const character = this.characterOf(duel, you);
      const clues = cluesFor(character, playable);
      const terms = matchTerms(character);
      const fits = candidates(
        withOwn(atLevel, character),
        mine.asked,
        mine.wrong,
        byId,
      );
      // Only needed on your own turn; the waiting player's app polls without them.
      const helping = duel.status === DuelStatus.ACTIVE && duel.turn === you;
      const questionsLeft = Math.max(0, MAX_QUESTIONS - mine.asked.length);
      const useful =
        helping && questionsLeft > 0
          ? usefulQuestions(fits, mine.asked, byId)
          : [];
      me = {
        asked: asked(mine),
        hints: clues.slice(0, mine.hints).map((ref) => ({
          label: label(ref),
          text: maskNames(verse(ref)?.text ?? '', terms),
        })),
        hintsLeft: Math.max(0, clues.length - mine.hints),
        wrongGuesses: mine.wrong.map((id) => ({
          id,
          name: byId.get(id)?.name ?? id,
        })),
        guessesLeft: MAX_WRONG_GUESSES - mine.wrong.length,
        stillPossible: fits.length,
        questionsLeft,
        suggestions: useful.slice(0, SUGGESTED_QUESTIONS),
        usefulQuestions: useful,
        possibleNames: helping ? possibleNames(duel.difficulty, fits) : null,
        worth: worthNow(
          duel.difficulty,
          mine.asked.length,
          mine.hints,
          mine.wrong.length,
        ),
      };
    }
    return {
      id: duel.id,
      difficulty: duel.difficulty,
      status: duel.status,
      you,
      opponent: {
        id: this.memberOf(duel, them),
        name: players.get(this.memberOf(duel, them)) ?? 'A member',
      },
      yourTurn: duel.status === DuelStatus.ACTIVE && duel.turn === you,
      finalTurn: duel.finalTurn,
      turnNumber: duel.turnNumber,
      turnDeadline: duel.turnDeadline?.toISOString() ?? null,
      me,
      them: started
        ? {
            asked: asked(theirs),
            hints: theirs.hints,
            wrongGuesses: theirs.wrong.length,
            guessesLeft: MAX_WRONG_GUESSES - theirs.wrong.length,
            stillPossible: stillPossible(
              withOwn(atLevel, this.characterOf(duel, them)),
              theirs.asked,
              theirs.wrong,
              byId,
            ),
          }
        : null,
      result:
        finished && started
          ? {
              outcome: this.outcome(duel, you)!,
              reason: duel.reason!,
              points: this.pointsOf(duel, you),
              scored:
                you === 'challenger'
                  ? duel.challengerScored
                  : duel.opponentScored,
              yours: revealCharacter(this.characterOf(duel, you), playable),
              theirs: revealCharacter(this.characterOf(duel, them), playable),
            }
          : null,
      createdAt: duel.createdAt.toISOString(),
    };
  }

  private summary(
    duel: BibleCharacterDuel,
    memberId: string,
    names: Map<string, string>,
  ): DuelSummary {
    const you = this.sideOf(duel, memberId);
    const other = this.memberOf(duel, otherSide(you));
    return {
      id: duel.id,
      difficulty: duel.difficulty,
      status: duel.status,
      you,
      opponent: { id: other, name: names.get(other) ?? 'A member' },
      yourTurn:
        (duel.status === DuelStatus.ACTIVE && duel.turn === you) ||
        (duel.status === DuelStatus.INVITED && you === 'opponent'),
      finalTurn: duel.finalTurn,
      turnDeadline: duel.turnDeadline?.toISOString() ?? null,
      outcome: this.outcome(duel, you),
      points: this.pointsOf(duel, you),
      createdAt: duel.createdAt.toISOString(),
    };
  }

  private outcome(
    duel: BibleCharacterDuel,
    you: DuelSide,
  ): 'won' | 'lost' | 'draw' | null {
    if (duel.status !== DuelStatus.FINISHED || !duel.winner) return null;
    if (duel.winner === 'draw') return 'draw';
    return duel.winner === you ? 'won' : 'lost';
  }

  private pointsOf(duel: BibleCharacterDuel, side: DuelSide): number {
    const scored =
      side === 'challenger' ? duel.challengerScored : duel.opponentScored;
    if (!scored) return 0;
    return side === 'challenger' ? duel.challengerPoints : duel.opponentPoints;
  }

  private async lock(
    memberId: string,
    id: string,
  ): Promise<BibleCharacterDuel> {
    const duel = await this.txHost.tx
      .getRepository(BibleCharacterDuel)
      .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (
      !duel ||
      (duel.challengerId !== memberId && duel.opponentId !== memberId)
    )
      throw new NotFoundException('Duel not found');
    return duel;
  }

  private async openCount(memberId: string): Promise<number> {
    return this.duelRepo.count({
      where: [
        { challengerId: memberId, status: In(OPEN_DUEL_STATUSES) },
        { opponentId: memberId, status: In(OPEN_DUEL_STATUSES) },
      ],
    });
  }

  private async notInService(memberId: string): Promise<void> {
    if (await this.bibleGames.inService(memberId))
      throw new ConflictException({
        code: 'SERVICE_IN_PROGRESS',
        message: 'Bible games open again after the service.',
      });
  }

  private async names(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = (await this.txHost.tx.query(
      `SELECT id, firstname, lastname FROM members WHERE id = ANY($1::uuid[])`,
      [unique],
    )) as { id: string; firstname: string; lastname: string }[];
    return new Map(rows.map((r) => [r.id, fullName(r)]));
  }

  private notify(
    memberId: string,
    key: PushNotificationKey,
    duel: BibleCharacterDuel,
    vars: Record<string, string | number | undefined>,
  ): void {
    this.push
      .dispatchToMemberIds([memberId], {
        key,
        vars,
        url: `/games/characters/duels/${duel.id}`,
        idempotencyKey: `duel:${duel.id}:${key}:${duel.turnNumber}`,
      })
      .catch((err) =>
        this.logger.warn(`Duel push failed: ${(err as Error)?.message}`),
      );
  }

  private deadline(hours: number): Date {
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  private sideOf(duel: BibleCharacterDuel, memberId: string): DuelSide {
    return duel.challengerId === memberId ? 'challenger' : 'opponent';
  }

  private memberOf(duel: BibleCharacterDuel, side: DuelSide): string {
    return side === 'challenger' ? duel.challengerId : duel.opponentId;
  }

  private stateOf(duel: BibleCharacterDuel, side: DuelSide): DuelSideState {
    return side === 'challenger' ? duel.challengerState : duel.opponentState;
  }

  private characterOf(
    duel: BibleCharacterDuel,
    side: DuelSide,
  ): BibleCharacter {
    const id =
      side === 'challenger' ? duel.challengerCharacter : duel.opponentCharacter;
    const c = id ? characterData().byId.get(id) : undefined;
    if (!c) throw new NotFoundException('Character not found');
    return c;
  }
}

const fullName = (m: { firstname: string; lastname: string }) =>
  [m.firstname, m.lastname].filter(Boolean).join(' ');

const lastGuessOnly = () =>
  new ConflictException({
    code: 'LAST_GUESS_ONLY',
    message: 'They found theirs. You have one last guess to draw level.',
  });

const duelOver = () =>
  new ConflictException({
    code: 'DUEL_OVER',
    message: 'This duel has finished.',
  });
