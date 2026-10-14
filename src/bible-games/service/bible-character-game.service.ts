import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { startOfDay, startOfMonth } from 'date-fns';
import {
  BibleCharacterRound,
  CharacterRoundStatus,
} from '../entity/bible-character-round.entity';
import {
  BibleCharacter,
  CHARACTER_QUESTIONS,
  Difficulty,
  QUESTION,
  QUESTION_GROUPS,
  answer,
  characterData,
  maskNames,
  matchTerms,
} from '../engine/characters';
import {
  DAILY_SCORED_GAMES,
  FREE_QUESTIONS,
  HINT_COST_PERCENT,
  MAX_QUESTIONS,
  MAX_WRONG_GUESSES,
  MIN_PERCENT,
  QUESTION_COST_PERCENT,
  START_POINTS,
  WRONG_GUESS_COST_PERCENT,
  SUGGESTED_QUESTIONS,
  candidates,
  questionLimitReached,
  withOwn,
  possibleNames,
  usefulQuestions,
  worthNow,
} from '../engine/character-game';
import { label, verse } from '../engine/bible';
import { RevealedCharacter, cluesFor, revealCharacter } from '../engine/reveal';
import { BibleCharactersService } from './bible-characters.service';
import { BibleGamesService } from './bible-games.service';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';

// Characters from a member's last few games are skipped when picking a new one.
const RECENT_GAMES = 20;
const CHARADES_DECK_SIZE = 80;

export interface CharacterRoundView {
  id: string;
  difficulty: Difficulty;
  status: CharacterRoundStatus;
  asked: { questionId: string; text: string; answer: boolean }[];
  hints: { label: string; text: string }[];
  hintsLeft: number;
  wrongGuesses: { id: string; name: string }[];
  guessesLeft: number;
  stillPossible: number;
  questionsLeft: number;
  // Best next questions, every question that can still narrow it down, and (Easy, or Medium near the end) who's left.
  suggestions: string[];
  usefulQuestions: string[];
  possibleNames: { id: string; name: string }[] | null;
  worth: number;
  result: CharacterResult | null;
}

export interface CharacterResult {
  won: boolean;
  points: number;
  // False for a win beyond the day's scored games.
  scored: boolean;
  questionsAsked: number;
  character: RevealedCharacter;
  rankThisMonth: number | null;
}

@Injectable()
export class BibleCharacterGameService {
  constructor(
    @InjectRepository(BibleCharacterRound)
    private readonly roundRepo: Repository<BibleCharacterRound>,
    private readonly characters: BibleCharactersService,
    private readonly bibleGames: BibleGamesService,
    private readonly churchTimezone: ChurchTimezoneService,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async overview(memberId: string) {
    const [pool, active, scoredToday, month, all] = await Promise.all([
      this.characters.playable(),
      this.roundRepo.findOne({
        where: { memberId, status: CharacterRoundStatus.ACTIVE },
      }),
      this.scoredToday(memberId),
      this.bibleGames.scoreboard(memberId, 'month', 1, 'characters'),
      this.bibleGames.scoreboard(memberId, 'all', 1, 'characters'),
    ]);
    return {
      groups: QUESTION_GROUPS,
      questions: CHARACTER_QUESTIONS.map((q) => ({
        id: q.id,
        group: q.group,
        text: q.text,
      })),
      // Every name in play, for the guess search; nothing here gives an answer away.
      names: (active ? withOwn(pool, this.characterOf(active)) : pool)
        .map((c) => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      counts: {
        easy: pool.filter((c) => c.difficulty === 'easy').length,
        medium: pool.filter((c) => c.difficulty === 'medium').length,
        hard: pool.filter((c) => c.difficulty === 'hard').length,
      },
      active: active ? await this.view(active, pool) : null,
      inService: await this.bibleGames.inService(memberId),
      today: {
        scored: scoredToday,
        limit: DAILY_SCORED_GAMES,
      },
      points: {
        month: month.me.points,
        allTime: all.me.points,
        rankThisMonth: month.me.rank,
      },
      rules: {
        startPoints: START_POINTS,
        freeQuestions: FREE_QUESTIONS,
        questionCostPercent: QUESTION_COST_PERCENT,
        hintCostPercent: HINT_COST_PERCENT,
        wrongGuessCostPercent: WRONG_GUESS_COST_PERCENT,
        minPercent: MIN_PERCENT,
        maxWrongGuesses: MAX_WRONG_GUESSES,
        maxQuestions: MAX_QUESTIONS,
      },
    };
  }

  async start(
    memberId: string,
    difficulty: Difficulty,
  ): Promise<CharacterRoundView> {
    if (await this.bibleGames.inService(memberId)) {
      throw new ConflictException({
        code: 'SERVICE_IN_PROGRESS',
        message: 'Bible games open again after the service.',
      });
    }
    const pool = await this.characters.playable();
    const candidates = pool.filter((c) => c.difficulty === difficulty);
    if (!candidates.length) {
      throw new ConflictException({
        code: 'NO_CHARACTERS',
        message: 'There are no characters at this level yet.',
      });
    }
    const recent = new Set(
      (
        await this.roundRepo.find({
          where: { memberId },
          order: { createdAt: 'DESC' },
          take: RECENT_GAMES,
          select: { characterId: true },
        })
      ).map((r) => r.characterId),
    );
    const fresh = candidates.filter((c) => !recent.has(c.id));
    const choices = fresh.length ? fresh : candidates;
    const character = choices[Math.floor(Math.random() * choices.length)];

    // Starting again leaves the game in progress unfinished, with no points.
    await this.roundRepo.update(
      { memberId, status: CharacterRoundStatus.ACTIVE },
      { status: CharacterRoundStatus.ABANDONED, finishedAt: new Date() },
    );
    const round = await this.roundRepo.save(
      this.roundRepo.create({
        memberId,
        characterId: character.id,
        difficulty,
        status: CharacterRoundStatus.ACTIVE,
        asked: [],
        hints: 0,
        wrongGuesses: [],
      }),
    );
    return this.view(round, pool);
  }

  async state(memberId: string, roundId: string): Promise<CharacterRoundView> {
    const round = await this.own(memberId, roundId);
    return this.view(round, await this.characters.playable());
  }

  async ask(
    memberId: string,
    roundId: string,
    questionId: string,
  ): Promise<CharacterRoundView> {
    const round = await this.active(memberId, roundId);
    if (!QUESTION.has(questionId))
      throw new BadRequestException('Unknown question');
    if (round.asked.some((a) => a.q === questionId))
      throw new ConflictException({
        code: 'ALREADY_ASKED',
        message: 'You have already asked that.',
      });
    if (round.asked.length >= MAX_QUESTIONS)
      throw new ConflictException(questionLimitReached());
    round.asked = [
      ...round.asked,
      { q: questionId, a: answer(questionId, this.characterOf(round)) },
    ];
    await this.roundRepo.save(round);
    return this.view(round, await this.characters.playable());
  }

  async hint(memberId: string, roundId: string): Promise<CharacterRoundView> {
    const round = await this.active(memberId, roundId);
    const clues = this.cluesOf(round, await this.characters.playable());
    if (round.hints >= clues.length)
      throw new ConflictException({
        code: 'NO_HINTS_LEFT',
        message: 'There are no more hints for this character.',
      });
    round.hints += 1;
    await this.roundRepo.save(round);
    return this.view(round, await this.characters.playable());
  }

  async guess(
    memberId: string,
    roundId: string,
    characterId: string,
  ): Promise<CharacterRoundView> {
    const round = await this.active(memberId, roundId);
    if (!characterData().byId.has(characterId))
      throw new BadRequestException('Unknown character');
    if (round.wrongGuesses.includes(characterId))
      throw new ConflictException({
        code: 'ALREADY_GUESSED',
        message: 'You have already guessed them.',
      });
    if (characterId === round.characterId) {
      await this.finish(round, CharacterRoundStatus.WON);
    } else {
      round.wrongGuesses = [...round.wrongGuesses, characterId];
      if (round.wrongGuesses.length >= MAX_WRONG_GUESSES) {
        await this.finish(round, CharacterRoundStatus.LOST);
      } else {
        await this.roundRepo.save(round);
      }
    }
    return this.view(round, await this.characters.playable());
  }

  async giveUp(memberId: string, roundId: string): Promise<CharacterRoundView> {
    const round = await this.active(memberId, roundId);
    await this.finish(round, CharacterRoundStatus.GAVE_UP);
    return this.view(round, await this.characters.playable());
  }

  // Bible Charades: a shuffled deck for a party round on one phone. Nothing is stored and nothing scores.
  async charadesDeck(difficulty?: Difficulty) {
    const pool = (await this.characters.playable()).filter(
      (c) => !difficulty || c.difficulty === difficulty,
    );
    const deck = pool.map((c) => ({
      id: c.id,
      name: c.name,
      summary: c.summary,
      testament: c.testament,
      difficulty: c.difficulty,
    }));
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return { deck: deck.slice(0, CHARADES_DECK_SIZE) };
  }

  // Leaders' view: this month's games and which characters people find hardest.
  async adminStats() {
    const timezone = await this.churchTimezone.get();
    const monthStart = fromZonedTime(
      startOfMonth(toZonedTime(new Date(), timezone)),
      timezone,
    );
    const rows = (await this.txHost.tx.query(
      `SELECT character_id AS "characterId",
              COUNT(*)::int AS played,
              COUNT(*) FILTER (WHERE status = 'won')::int AS wins,
              ROUND(AVG(jsonb_array_length(asked)), 1)::float AS "avgQuestions"
       FROM bible_character_rounds
       WHERE finished_at IS NOT NULL AND finished_at >= $1 AND status <> 'abandoned'
       GROUP BY character_id`,
      [monthStart],
    )) as {
      characterId: string;
      played: number;
      wins: number;
      avgQuestions: number;
    }[];
    const players = (await this.txHost.tx.query(
      `SELECT COUNT(DISTINCT member_id)::int AS n FROM bible_character_rounds
       WHERE finished_at IS NOT NULL AND finished_at >= $1 AND status <> 'abandoned'`,
      [monthStart],
    )) as { n: number }[];
    const { byId } = characterData();
    const played = rows.reduce((n, r) => n + r.played, 0);
    const wins = rows.reduce((n, r) => n + r.wins, 0);
    return {
      gamesThisMonth: played,
      playersThisMonth: players[0]?.n ?? 0,
      winsThisMonth: wins,
      hardest: rows
        .filter((r) => r.played >= 3 && byId.has(r.characterId))
        .map((r) => ({
          id: r.characterId,
          name: byId.get(r.characterId)!.name,
          played: r.played,
          wins: r.wins,
          avgQuestions: r.avgQuestions,
        }))
        .sort((a, b) => a.wins / a.played - b.wins / b.played)
        .slice(0, 5),
    };
  }

  private async finish(
    round: BibleCharacterRound,
    status: CharacterRoundStatus,
  ): Promise<void> {
    round.status = status;
    round.finishedAt = new Date();
    if (status === CharacterRoundStatus.WON) {
      round.points = worthNow(
        round.difficulty,
        round.asked.length,
        round.hints,
        round.wrongGuesses.length,
      );
      round.scored =
        (await this.scoredToday(round.memberId)) < DAILY_SCORED_GAMES;
    }
    await this.roundRepo.save(round);
    if (status === CharacterRoundStatus.WON && round.scored) {
      await this.bibleGames.awardPoints(
        round.memberId,
        'characters',
        round.points,
        1,
      );
    }
  }

  // Scored wins today, Solo and Duel together, against the shared daily limit.
  async scoredToday(memberId: string): Promise<number> {
    const timezone = await this.churchTimezone.get();
    const dayStart = fromZonedTime(
      startOfDay(toZonedTime(new Date(), timezone)),
      timezone,
    );
    const rows = (await this.txHost.tx.query(
      `SELECT (SELECT COUNT(*) FROM bible_character_rounds
                WHERE member_id = $1 AND scored AND created_at >= $2)
            + (SELECT COUNT(*) FROM bible_character_duels
                WHERE challenger_id = $1 AND challenger_scored AND finished_at >= $2)
            + (SELECT COUNT(*) FROM bible_character_duels
                WHERE opponent_id = $1 AND opponent_scored AND finished_at >= $2) AS n`,
      [memberId, dayStart],
    )) as { n: string | number }[];
    return Number(rows[0]?.n ?? 0);
  }

  private async view(
    round: BibleCharacterRound,
    pool: BibleCharacter[],
  ): Promise<CharacterRoundView> {
    const { byId } = characterData();
    const clues = this.cluesOf(round, pool);
    const character = this.characterOf(round);
    const terms = matchTerms(character);
    const done = round.status !== CharacterRoundStatus.ACTIVE;
    const fits = candidates(
      withOwn(
        pool.filter((c) => c.difficulty === round.difficulty),
        character,
      ),
      round.asked,
      round.wrongGuesses,
      byId,
    );
    const questionsLeft = Math.max(0, MAX_QUESTIONS - round.asked.length);
    const useful =
      done || questionsLeft === 0
        ? []
        : usefulQuestions(fits, round.asked, byId);
    return {
      id: round.id,
      difficulty: round.difficulty,
      status: round.status,
      asked: round.asked.map((a) => ({
        questionId: a.q,
        text: QUESTION.get(a.q)?.text ?? a.q,
        answer: a.a,
      })),
      hints: clues.slice(0, round.hints).map((ref) => ({
        label: label(ref),
        text: maskNames(verse(ref)?.text ?? '', terms),
      })),
      hintsLeft: Math.max(0, clues.length - round.hints),
      wrongGuesses: round.wrongGuesses.map((id) => ({
        id,
        name: byId.get(id)?.name ?? id,
      })),
      guessesLeft: MAX_WRONG_GUESSES - round.wrongGuesses.length,
      stillPossible: fits.length,
      questionsLeft,
      suggestions: useful.slice(0, SUGGESTED_QUESTIONS),
      usefulQuestions: useful,
      possibleNames: done ? null : possibleNames(round.difficulty, fits),
      worth: worthNow(
        round.difficulty,
        round.asked.length,
        round.hints,
        round.wrongGuesses.length,
      ),
      result: done ? await this.result(round, character, pool) : null,
    };
  }

  private async result(
    round: BibleCharacterRound,
    character: BibleCharacter,
    pool: BibleCharacter[],
  ): Promise<CharacterResult> {
    const month = await this.bibleGames.scoreboard(
      round.memberId,
      'month',
      1,
      'characters',
    );
    return {
      won: round.status === CharacterRoundStatus.WON,
      points: round.scored ? round.points : 0,
      scored: round.scored,
      questionsAsked: round.asked.length,
      character: revealCharacter(character, pool),
      rankThisMonth: month.me.rank,
    };
  }

  private cluesOf(
    round: BibleCharacterRound,
    pool: BibleCharacter[],
  ): string[] {
    return cluesFor(this.characterOf(round), pool);
  }

  private characterOf(round: BibleCharacterRound): BibleCharacter {
    const c = characterData().byId.get(round.characterId);
    if (!c) throw new NotFoundException('Character not found');
    return c;
  }

  private async own(
    memberId: string,
    roundId: string,
  ): Promise<BibleCharacterRound> {
    const round = await this.roundRepo.findOne({
      where: { id: roundId, memberId },
    });
    if (!round) throw new NotFoundException('Game not found');
    return round;
  }

  private async active(
    memberId: string,
    roundId: string,
  ): Promise<BibleCharacterRound> {
    const round = await this.own(memberId, roundId);
    if (round.status !== CharacterRoundStatus.ACTIVE)
      throw new ConflictException({
        code: 'GAME_OVER',
        message: 'This game has finished.',
      });
    return round;
  }
}
