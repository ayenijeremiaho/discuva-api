import { buildRound, buildVerseRound } from './round';
import {
  DAILY_QUESTIONS,
  DAILY_SPEC,
  LEVELS,
  LEVEL_COUNT,
  pointsFor,
} from './levels';
import { seededRng } from './rng';
import { label, verse } from './bible';
import { makeQuestion } from './questions';
import { isName, isRealPhrase, normWord, sameTextRefs } from './corpus';
import { bibleData } from './bible';

const FAMILIAR = [
  'Genesis',
  'Exodus',
  'Leviticus',
  'Numbers',
  'Deuteronomy',
  'Joshua',
  'Judges',
  'Ruth',
  '1 Samuel',
  '2 Samuel',
  '1 Kings',
  '2 Kings',
  'Psalms',
  'Proverbs',
  'Ecclesiastes',
  'Isaiah',
  'Jeremiah',
  'Daniel',
  'Matthew',
  'Mark',
  'Luke',
  'John',
  'Acts',
  'Romans',
  '1 Corinthians',
  '2 Corinthians',
  'Galatians',
  'Ephesians',
  'Philippians',
  'Colossians',
  '1 Timothy',
  '2 Timothy',
  'Hebrews',
  'James',
  '1 Peter',
  '2 Peter',
  '1 John',
  'Revelation',
];

describe('Bible questions', () => {
  it('has 20 levels getting faster', () => {
    expect(LEVELS).toHaveLength(LEVEL_COUNT);
    expect(LEVELS[0].timeLimit).toBeGreaterThan(
      LEVELS[LEVEL_COUNT - 1].timeLimit,
    );
  });

  it('fills every level with 10 valid, distinct questions', () => {
    for (const spec of LEVELS) {
      for (let s = 0; s < 15; s++) {
        const round = buildRound(
          seededRng(`spec-${spec.level}-${s}`),
          spec,
          10,
        );
        expect(round).toHaveLength(10);
        expect(new Set(round.map((q) => q.key)).size).toBe(10);
        for (const q of round) {
          expect(q.options[q.answer]).toBeDefined();
          expect(new Set(q.options).size).toBe(q.options.length);
          expect(q.options).toHaveLength(q.kind === 'testament' ? 2 : 4);
        }
      }
    }
  });

  it('keeps a round varied', () => {
    for (let s = 0; s < 20; s++) {
      const kinds = buildRound(seededRng(`mix-${s}`), LEVELS[0], 10).map(
        (q) => q.kind,
      );
      const counts = kinds.reduce<Record<string, number>>(
        (m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }),
        {},
      );
      expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(4);
    }
  });

  it('gives everyone the same Daily Challenge on a day, and a different one the next day', () => {
    const a = buildRound(
      seededRng('church:daily:2026-10-08'),
      DAILY_SPEC,
      DAILY_QUESTIONS,
    );
    const b = buildRound(
      seededRng('church:daily:2026-10-08'),
      DAILY_SPEC,
      DAILY_QUESTIONS,
    );
    const c = buildRound(
      seededRng('church:daily:2026-10-09'),
      DAILY_SPEC,
      DAILY_QUESTIONS,
    );
    expect(a).toEqual(b);
    expect(a.map((q) => q.key)).not.toEqual(c.map((q) => q.key));
  });

  it('gives different members different level rounds', () => {
    const a = buildRound(seededRng('member-a'), LEVELS[4], 10).map(
      (q) => q.key,
    );
    const b = buildRound(seededRng('member-b'), LEVELS[4], 10).map(
      (q) => q.key,
    );
    expect(a).not.toEqual(b);
  });

  it('avoids questions seen recently', () => {
    const first = buildRound(seededRng('x'), LEVELS[2], 10);
    const avoid = new Set(first.map((q) => q.key));
    const next = buildRound(seededRng('x'), LEVELS[2], 10, { avoid });
    const repeats = next.filter((q) => avoid.has(q.key)).length;
    expect(repeats).toBe(0);
  });

  it('only asks starters about books most people know', () => {
    let checked = 0;
    for (let s = 0; s < 80; s++) {
      const q = makeQuestion(seededRng(`f-${s}`), {
        kind: 'next',
        familiar: true,
      });
      if (!q) continue;
      checked++;
      q.options.forEach((o) => expect(FAMILIAR).toContain(o));
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('blanks a real word of the verse and shows the full verse after', () => {
    const [q] = buildVerseRound(seededRng('v'), ['JHN.3.16'], 1);
    expect(q.prompt).toContain('___');
    expect(q.explain).toContain('For God so loved the world');
    expect(verse('JHN.3.16')!.text).toContain(q.options[q.answer]);
  });

  it('strips psalm titles and names single psalms', () => {
    expect(verse('PSA.23.1')!.text).toBe(
      'The LORD is my shepherd; I shall not want.',
    );
    expect(label('PSA.23.1')).toBe('Psalm 23:1');
    expect(label('JUD.1.3')).toBe('Jude 3');
  });

  it('pays more for harder levels and for speed', () => {
    expect(pointsFor(1, 0, 20)).toBe(10);
    expect(pointsFor(1, 20, 20)).toBe(15);
    expect(pointsFor(20, 0, 12)).toBe(105);
    expect(pointsFor(20, 12, 12)).toBe(157);
    expect(pointsFor(5, 30, 20)).toBe(pointsFor(5, 20, 20));
  });

  describe('wrong options', () => {
    const wordQuestions = Array.from({ length: 300 }, (_, i) =>
      makeQuestion(seededRng(`w-${i}`), {
        kind: i % 2 ? 'finish' : 'missing',
        band: 1500,
      }),
    ).filter((q): q is NonNullable<typeof q> => !!q);

    it('never offer a word that would also make a real KJV phrase in that spot', () => {
      expect(wordQuestions.length).toBeGreaterThan(250);
      for (const q of wordQuestions) {
        const [, ref, index] = q.key.split(':');
        const words = verse(ref)!.text.split(' ');
        const i = Number(index);
        const before =
          i > 0 && !/[.:;?!]$/.test(words[i - 1])
            ? normWord(words[i - 1])
            : null;
        const after =
          !/[.,:;?!]$/.test(words[i]) && i < words.length - 1
            ? normWord(words[i + 1])
            : null;
        if (!before || !after) continue;
        q.options.forEach((o, k) => {
          if (k !== q.answer)
            expect(isRealPhrase(o, before, after)).toBe(false);
        });
      }
    });

    it('never offer a name for an ordinary word', () => {
      for (const q of wordQuestions) {
        if (isName(q.options[q.answer])) continue;
        q.options.forEach((o, k) => {
          if (k !== q.answer) expect(isName(o)).toBe(false);
        });
      }
    });

    it('skip verses that appear word for word elsewhere when asking where a verse is', () => {
      const twins = bibleData().popular.filter(
        (r) => sameTextRefs(r).length > 0,
      );
      expect(twins.length).toBeGreaterThan(0);
      const twinSet = new Set(twins);
      for (let i = 0; i < 300; i++) {
        const q = makeQuestion(seededRng(`t-${i}`), {
          kind: 'book',
          band: 4000,
        });
        if (q) expect(twinSet.has(q.key.split(':')[1])).toBe(false);
      }
    });
  });

  it('mixes in at most two church questions and skips hidden ones', () => {
    const extras = ['a', 'b', 'c'].map((id) => ({
      key: `custom:${id}`,
      kind: 'custom' as const,
      prompt: id,
      options: ['x', 'y'],
      answer: 0,
      explain: '',
    }));
    const round = buildRound(seededRng('mix'), LEVELS[0], 10, {
      extras,
      exclude: (q) => q.kind === 'testament',
    });
    expect(round).toHaveLength(10);
    expect(round.filter((q) => q.kind === 'custom')).toHaveLength(2);
    expect(round.some((q) => q.kind === 'testament')).toBe(false);
  });
});
