import { characterData } from './characters';
import {
  MIN_PERCENT,
  START_POINTS,
  stillPossible,
  worthNow,
} from './character-game';

describe('Guess the Bible Character scoring', () => {
  it('is worth the full start for the first few questions, then drops 5% a question', () => {
    expect(worthNow('medium', 0, 0, 0)).toBe(100);
    expect(worthNow('medium', 3, 0, 0)).toBe(100);
    expect(worthNow('medium', 4, 0, 0)).toBe(95);
    expect(worthNow('hard', 10, 0, 0)).toBe(98);
  });

  it('charges for hints and wrong guesses, but never below a fifth', () => {
    expect(worthNow('easy', 3, 1, 1)).toBe(45);
    expect(worthNow('medium', 60, 3, 2)).toBe(
      (START_POINTS.medium * MIN_PERCENT) / 100,
    );
  });

  it('narrows the field with every answer', () => {
    const { list, byId } = characterData();
    const all = stillPossible(list, [], [], byId);
    const kings = stillPossible(list, [{ q: 'king', a: true }], [], byId);
    const israelKings = stillPossible(
      list,
      [
        { q: 'king', a: true },
        { q: 'israelite', a: true },
      ],
      [],
      byId,
    );
    expect(all).toBe(list.length);
    expect(kings).toBeLessThan(all);
    expect(israelKings).toBeLessThan(kings);
    expect(stillPossible(list, [{ q: 'king', a: true }], ['david'], byId)).toBe(
      kings - 1,
    );
  });
});
