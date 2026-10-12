import { BibleCharacter, Difficulty, answer } from './characters';

// Points for finding the character, before costs; harder characters are worth more.
export const START_POINTS: Record<Difficulty, number> = {
  easy: 60,
  medium: 100,
  hard: 150,
};
// The first few questions are free; after that each costs a share of the start (whole percentages).
export const FREE_QUESTIONS = 3;
export const QUESTION_COST_PERCENT = 5;
export const HINT_COST_PERCENT = 15;
export const WRONG_GUESS_COST_PERCENT = 10;
// Finding the character always earns at least a fifth of the start.
export const MIN_PERCENT = 20;
export const MAX_WRONG_GUESSES = 3;
// Games won after this many in a day are for fun and add no points.
export const DAILY_SCORED_GAMES = 5;

export interface AskedQuestion {
  q: string;
  a: boolean;
}

export function worthNow(
  difficulty: Difficulty,
  asked: number,
  hints: number,
  wrongGuesses: number,
): number {
  const percent =
    100 -
    QUESTION_COST_PERCENT * Math.max(0, asked - FREE_QUESTIONS) -
    HINT_COST_PERCENT * hints -
    WRONG_GUESS_COST_PERCENT * wrongGuesses;
  return Math.round(
    (START_POINTS[difficulty] * Math.max(MIN_PERCENT, percent)) / 100,
  );
}

// How many characters still fit every answer so far (and haven't been wrongly guessed); pass the
// characters at the game's difficulty, since the player chose it.
export function stillPossible(
  pool: BibleCharacter[],
  asked: AskedQuestion[],
  wrongGuesses: string[],
  all: ReadonlyMap<string, BibleCharacter>,
): number {
  return pool.filter(
    (c) =>
      !wrongGuesses.includes(c.id) &&
      asked.every((x) => answer(x.q, c, all) === x.a),
  ).length;
}
