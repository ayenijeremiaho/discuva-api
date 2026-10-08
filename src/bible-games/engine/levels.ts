import { KindSpec } from './questions';

export interface LevelSpec {
  level: number;
  tier: string;
  timeLimit: number;
  kinds: [KindSpec, number][];
}

export const LEVEL_COUNT = 20;
export const QUESTIONS_PER_ROUND = 10;
export const PASS_MARK = 7;
export const DAILY_QUESTIONS = 5;

const tier = (level: number) =>
  level <= 4
    ? 'Starter'
    : level <= 9
      ? 'Growing'
      : level <= 14
        ? 'Rooted'
        : 'Deep';

// Easy → hard: book facts and famous verses first, then less familiar verses, then references, chapters and linked verses.
const TABLE: [number, KindSpec[], number[]][] = [
  [
    20,
    [
      { kind: 'testament', familiar: true },
      { kind: 'next', familiar: true },
      { kind: 'finish', band: 60, maxWords: 22 },
    ],
    [3, 3, 4],
  ],
  [
    20,
    [
      { kind: 'testament' },
      { kind: 'next', familiar: true },
      { kind: 'before', familiar: true },
      { kind: 'finish', band: 100, maxWords: 26 },
    ],
    [2, 2, 2, 4],
  ],
  [
    20,
    [
      { kind: 'next' },
      { kind: 'before', familiar: true },
      { kind: 'finish', band: 150, maxWords: 30 },
      { kind: 'book', band: 60 },
    ],
    [2, 2, 3, 3],
  ],
  [
    20,
    [
      { kind: 'finish', band: 250 },
      { kind: 'book', band: 120 },
      { kind: 'order' },
    ],
    [4, 4, 2],
  ],
  [
    20,
    [
      { kind: 'finish', band: 400 },
      { kind: 'missing', band: 200 },
      { kind: 'book', band: 200 },
    ],
    [3, 3, 4],
  ],
  [
    18,
    [
      { kind: 'missing', band: 300 },
      { kind: 'book', band: 300 },
      { kind: 'order' },
      { kind: 'finish', band: 500 },
    ],
    [3, 3, 1, 3],
  ],
  [
    18,
    [
      { kind: 'missing', band: 500 },
      { kind: 'book', band: 500 },
      { kind: 'reference', band: 150 },
    ],
    [3, 4, 3],
  ],
  [
    18,
    [
      { kind: 'reference', band: 300 },
      { kind: 'missing', band: 700 },
      { kind: 'book', band: 700 },
    ],
    [3, 3, 4],
  ],
  [
    18,
    [
      { kind: 'reference', band: 500 },
      { kind: 'missing', band: 1000 },
      { kind: 'book', band: 1000 },
    ],
    [4, 3, 3],
  ],
  [
    18,
    [
      { kind: 'reference', band: 800 },
      { kind: 'chapter', band: 300 },
      { kind: 'missing', band: 1200 },
    ],
    [4, 3, 3],
  ],
  [
    16,
    [
      { kind: 'reference', band: 1200 },
      { kind: 'chapter', band: 500 },
      { kind: 'book', band: 1500 },
      { kind: 'missing', band: 1500 },
    ],
    [3, 3, 2, 2],
  ],
  [
    16,
    [
      { kind: 'chapter', band: 800 },
      { kind: 'reference', band: 1600 },
      { kind: 'order' },
    ],
    [4, 5, 1],
  ],
  [
    16,
    [
      { kind: 'chapter', band: 1200 },
      { kind: 'reference', band: 2000 },
      { kind: 'missing', band: 2000 },
    ],
    [4, 4, 2],
  ],
  [
    16,
    [
      { kind: 'chapter', band: 1600 },
      { kind: 'related', band: 300 },
      { kind: 'reference', band: 2500 },
    ],
    [4, 2, 4],
  ],
  [
    15,
    [
      { kind: 'related', band: 500 },
      { kind: 'chapter', band: 2000 },
      { kind: 'reference', band: 3000 },
    ],
    [3, 4, 3],
  ],
  [
    15,
    [
      { kind: 'related', band: 700 },
      { kind: 'chapter', band: 2500 },
      { kind: 'missing', band: 3000 },
      { kind: 'book', band: 3000 },
    ],
    [3, 3, 2, 2],
  ],
  [
    15,
    [
      { kind: 'related', band: 900 },
      { kind: 'chapter', band: 3000 },
      { kind: 'reference', band: 3500 },
    ],
    [3, 4, 3],
  ],
  [
    15,
    [
      { kind: 'related', band: 'all' },
      { kind: 'chapter', band: 4000 },
      { kind: 'reference', band: 4000 },
      { kind: 'missing', band: 4000 },
    ],
    [3, 3, 2, 2],
  ],
  [
    14,
    [
      { kind: 'related', band: 'all' },
      { kind: 'chapter', band: 'all' },
      { kind: 'reference', band: 'all' },
      { kind: 'book', band: 'all' },
    ],
    [3, 3, 2, 2],
  ],
  [
    12,
    [
      { kind: 'related', band: 'all' },
      { kind: 'chapter', band: 'all' },
      { kind: 'reference', band: 'all' },
      { kind: 'missing', band: 'all' },
    ],
    [3, 3, 2, 2],
  ],
];

export const LEVELS: LevelSpec[] = TABLE.map(
  ([timeLimit, kinds, weights], i) => ({
    level: i + 1,
    tier: tier(i + 1),
    timeLimit,
    kinds: kinds.map((k, j) => [k, weights[j]] as [KindSpec, number]),
  }),
);

export function levelSpec(level: number): LevelSpec {
  return LEVELS[Math.min(Math.max(level, 1), LEVEL_COUNT) - 1];
}

// Mid-difficulty mix shared by everyone's Daily Challenge.
export const DAILY_SPEC: LevelSpec = {
  level: 0,
  tier: 'Daily',
  timeLimit: 20,
  kinds: [
    [{ kind: 'finish', band: 300 }, 3],
    [{ kind: 'book', band: 300 }, 3],
    [{ kind: 'missing', band: 400 }, 2],
    [{ kind: 'reference', band: 200 }, 1],
    [{ kind: 'next' }, 1],
  ],
};

// Points for a right answer: 10 at level 1 up to 105 at level 20, plus up to half again for speed.
export function pointsFor(
  level: number,
  secondsLeft: number,
  timeLimit: number,
): number {
  const base = 10 + (Math.max(level, 1) - 1) * 5;
  const bonus = Math.floor(
    ((base / 2) * Math.max(0, Math.min(secondsLeft, timeLimit))) / timeLimit,
  );
  return base + bonus;
}
