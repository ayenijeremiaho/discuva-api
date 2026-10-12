import { parseRef } from './bible';
import {
  CHARACTER_QUESTIONS,
  answer,
  characterData,
  maskNames,
  matchTerms,
  validateCharacters,
} from './characters';

describe('Bible characters', () => {
  const { list, byId } = characterData();

  it('passes every data rule (verses, books, family links, distinguishable)', () => {
    expect(validateCharacters(list)).toEqual([]);
  });

  it('has around 180 characters across all three difficulties', () => {
    expect(list.length).toBeGreaterThanOrEqual(170);
    for (const d of ['easy', 'medium', 'hard'])
      expect(list.filter((c) => c.difficulty === d).length).toBeGreaterThan(30);
  });

  it('answers questions from the data', () => {
    const david = byId.get('david')!;
    expect(answer('king', david)).toBe(true);
    expect(answer('woman', david)).toBe(false);
    expect(answer('royal_child', david)).toBe(true);
    expect(answer('royal_parent', byId.get('solomon')!)).toBe(true);
    expect(answer('met_jesus', byId.get('peter')!)).toBe(true);
  });

  it('groups every question', () => {
    expect(CHARACTER_QUESTIONS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(CHARACTER_QUESTIONS.map((q) => q.id)).size).toBe(
      CHARACTER_QUESTIONS.length,
    );
  });

  it('masks every form of the name in a clue', () => {
    const abraham = byId.get('abraham')!;
    expect(
      maskNames(
        'Thy name shall not be called Abram, but Abraham',
        matchTerms(abraham),
      ),
    ).toBe('Thy name shall not be called ___, but ___');
  });

  it('reads verse references the way people write them', () => {
    expect(parseRef('Genesis 12:1')).toBe('GEN.12.1');
    expect(parseRef(' psalm  23:1 ')).toBe('PSA.23.1');
    expect(parseRef('1 Samuel 17:50')).toBe('1SA.17.50');
    expect(parseRef('Jude 14')).toBe('JUD.1.14');
    expect(parseRef('GEN.12.1')).toBe('GEN.12.1');
    expect(parseRef('Genesis 12')).toBeNull();
    expect(parseRef('Hezekiah 3:4')).toBeNull();
  });
});
