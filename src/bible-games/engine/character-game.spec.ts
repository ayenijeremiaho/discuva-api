import { answer, characterData } from './characters';
import {
  MEDIUM_NAMES_AT,
  MIN_PERCENT,
  START_POINTS,
  SUGGESTED_QUESTIONS,
  candidates,
  possibleNames,
  stillPossible,
  usefulQuestions,
  withOwn,
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

describe('Guess the Bible Character help', () => {
  const { list, byId } = characterData();

  it('suggests only questions that split the characters still in play, best split first', () => {
    const fits = candidates(list, [], [], byId);
    const useful = usefulQuestions(fits, [], byId);
    const yesShare = (id: string) =>
      fits.filter((c) => answer(id, c, byId)).length;
    const gap = (id: string) => Math.abs(fits.length / 2 - yesShare(id));

    expect(useful.length).toBeGreaterThan(SUGGESTED_QUESTIONS);
    for (const id of useful) {
      expect(yesShare(id)).toBeGreaterThan(0);
      expect(yesShare(id)).toBeLessThan(fits.length);
    }
    expect(gap(useful[0])).toBeLessThanOrEqual(gap(useful[useful.length - 1]));
  });

  it('drops questions already asked and ones every remaining character answers the same way', () => {
    const asked = [{ q: 'king', a: true }];
    const fits = candidates(list, asked, [], byId);
    const useful = usefulQuestions(fits, asked, byId);
    expect(useful).not.toContain('king');
    for (const id of useful) {
      const yes = fits.filter((c) => answer(id, c, byId)).length;
      expect(yes > 0 && yes < fits.length).toBe(true);
    }
  });

  it('has nothing left to ask once one character fits', () => {
    expect(usefulQuestions([list[0]], [], byId)).toEqual([]);
  });

  it('shows who is left on Easy, on Medium only near the end, and never on Hard', () => {
    const many = list.slice(0, MEDIUM_NAMES_AT + 1);
    const few = list.slice(0, MEDIUM_NAMES_AT);
    expect(possibleNames('easy', many)).toHaveLength(many.length);
    expect(possibleNames('medium', many)).toBeNull();
    expect(possibleNames('medium', few)).toHaveLength(few.length);
    expect(possibleNames('hard', few)).toBeNull();
    const names = possibleNames('easy', many)!.map((n) => n.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe('withOwn', () => {
  const { list } = characterData();
  it("adds the round's own character only when it's missing", () => {
    const [own, ...rest] = list;
    expect(withOwn(rest, own)).toContain(own);
    expect(withOwn(list, own)).toBe(list);
  });
});
