import { Difficulty } from './characters';
import {
  AskedQuestion,
  MIN_PERCENT,
  START_POINTS,
  worthNow,
} from './character-game';

export type DuelSide = 'challenger' | 'opponent';
export type DuelWinner = DuelSide | 'draw';
export type DuelReason =
  'found' | 'out_of_guesses' | 'timeout' | 'resigned' | 'draw';

export interface DuelSideState {
  asked: AskedQuestion[];
  hints: number;
  wrong: string[];
}

export const TURN_HOURS_OPTIONS = [6, 12, 24, 48, 72] as const;
export const DEFAULT_TURN_HOURS = 24;
// Invited plus in-play duels a member can have at once.
export const MAX_OPEN_DUELS = 10;
// The challenger picks the level, so the person invited moves first.
export const FIRST_MOVER: DuelSide = 'opponent';

export const otherSide = (s: DuelSide): DuelSide =>
  s === 'challenger' ? 'opponent' : 'challenger';

export const emptySide = (): DuelSideState => ({
  asked: [],
  hints: 0,
  wrong: [],
});

export type TurnOutcome =
  | { kind: 'next'; turn: DuelSide; finalTurn: boolean }
  | { kind: 'finished'; winner: DuelWinner; reason: DuelReason };

// One move: a question, a hint or a guess. If the first mover finds theirs, the other player gets one
// last guess so both have had the same number of turns; finding it then is a draw.
export function afterMove(
  mover: DuelSide,
  finalTurn: boolean,
  event: 'move' | 'found' | 'out',
): TurnOutcome {
  if (finalTurn) {
    return event === 'found'
      ? { kind: 'finished', winner: 'draw', reason: 'draw' }
      : { kind: 'finished', winner: otherSide(mover), reason: 'found' };
  }
  if (event === 'found') {
    return mover === FIRST_MOVER
      ? { kind: 'next', turn: otherSide(mover), finalTurn: true }
      : { kind: 'finished', winner: mover, reason: 'found' };
  }
  if (event === 'out') {
    return {
      kind: 'finished',
      winner: otherSide(mover),
      reason: 'out_of_guesses',
    };
  }
  return { kind: 'next', turn: otherSide(mover), finalTurn: false };
}

// Finding your character earns what it's worth now, as in Solo; winning without finding it
// (they ran out of guesses, ran out of time or resigned) earns the minimum.
export function duelPoints(
  difficulty: Difficulty,
  side: DuelSideState,
  found: boolean,
): number {
  return found
    ? worthNow(difficulty, side.asked.length, side.hints, side.wrong.length)
    : Math.round((START_POINTS[difficulty] * MIN_PERCENT) / 100);
}
