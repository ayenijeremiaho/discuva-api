import { afterMove, duelPoints, emptySide, otherSide } from './duel';

describe('duel turns', () => {
  it('passes the turn after a question, hint or wrong guess', () => {
    expect(afterMove('opponent', false, 'move')).toEqual({
      kind: 'next',
      turn: 'challenger',
      finalTurn: false,
    });
    expect(afterMove('challenger', false, 'move')).toEqual({
      kind: 'next',
      turn: 'opponent',
      finalTurn: false,
    });
  });

  it('gives the second player one last guess when the first mover finds theirs', () => {
    expect(afterMove('opponent', false, 'found')).toEqual({
      kind: 'next',
      turn: 'challenger',
      finalTurn: true,
    });
    expect(afterMove('challenger', true, 'found')).toEqual({
      kind: 'finished',
      winner: 'draw',
      reason: 'draw',
    });
    expect(afterMove('challenger', true, 'move')).toEqual({
      kind: 'finished',
      winner: 'opponent',
      reason: 'found',
    });
  });

  it('ends at once when the second mover finds theirs', () => {
    expect(afterMove('challenger', false, 'found')).toEqual({
      kind: 'finished',
      winner: 'challenger',
      reason: 'found',
    });
  });

  it('gives the win to the other player when one runs out of guesses', () => {
    expect(afterMove('opponent', false, 'out')).toEqual({
      kind: 'finished',
      winner: 'challenger',
      reason: 'out_of_guesses',
    });
    expect(otherSide('opponent')).toBe('challenger');
  });
});

describe('duelPoints', () => {
  it('scores a find like Solo and any other win at the minimum', () => {
    const side = {
      ...emptySide(),
      asked: Array.from({ length: 5 }, (_, i) => ({ q: `q${i}`, a: true })),
      hints: 1,
    };
    expect(duelPoints('medium', side, true)).toBe(75);
    expect(duelPoints('medium', side, false)).toBe(20);
    expect(duelPoints('hard', emptySide(), true)).toBe(150);
  });
});
