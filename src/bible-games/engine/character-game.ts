import {
  BibleCharacter,
  CHARACTER_QUESTIONS,
  Difficulty,
  answer,
} from './characters';

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
// "Twenty questions": after this many, the only move left is to guess. Points already bottom out just before it.
export const MAX_QUESTIONS = 20;

export const questionLimitReached = () => ({
  code: 'QUESTION_LIMIT',
  message: `You've asked all ${MAX_QUESTIONS} questions. Make your guess.`,
});
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

// The characters that still fit every answer so far (and haven't been wrongly guessed); pass the
// characters at the game's difficulty, since the player chose it.
export function candidates(
  pool: BibleCharacter[],
  asked: AskedQuestion[],
  wrongGuesses: string[],
  all: ReadonlyMap<string, BibleCharacter>,
): BibleCharacter[] {
  return pool.filter(
    (c) =>
      !wrongGuesses.includes(c.id) &&
      asked.every((x) => answer(x.q, c, all) === x.a),
  );
}

// A round's own character stays in its pool even if an admin hides it mid-game, or the round could never be won.
export function withOwn(
  pool: BibleCharacter[],
  own: BibleCharacter,
): BibleCharacter[] {
  return pool.some((c) => c.id === own.id) ? pool : [...pool, own];
}

export function stillPossible(
  pool: BibleCharacter[],
  asked: AskedQuestion[],
  wrongGuesses: string[],
  all: ReadonlyMap<string, BibleCharacter>,
): number {
  return candidates(pool, asked, wrongGuesses, all).length;
}

export const SUGGESTED_QUESTIONS = 3;
// Medium shows the names that still fit once this few remain; Easy always does, Hard never.
export const MEDIUM_NAMES_AT = 6;

// Unasked questions that would split the characters still in play, best split first (closest to half yes,
// half no). Built only from the player's own answers, so it never reveals anything about the hidden character.
export function usefulQuestions(
  fits: BibleCharacter[],
  asked: AskedQuestion[],
  all: ReadonlyMap<string, BibleCharacter>,
): string[] {
  const done = new Set(asked.map((a) => a.q));
  return CHARACTER_QUESTIONS.filter((q) => !done.has(q.id))
    .map((q, order) => {
      const yes = fits.filter((c) => answer(q.id, c, all)).length;
      return { id: q.id, order, split: Math.min(yes, fits.length - yes) };
    })
    .filter((q) => q.split > 0)
    .sort((a, b) => b.split - a.split || a.order - b.order)
    .map((q) => q.id);
}

export function possibleNames(
  difficulty: Difficulty,
  fits: BibleCharacter[],
): { id: string; name: string }[] | null {
  if (difficulty === 'hard') return null;
  if (difficulty === 'medium' && fits.length > MEDIUM_NAMES_AT) return null;
  return fits
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
