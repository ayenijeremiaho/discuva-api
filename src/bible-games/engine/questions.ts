import {
  BOOKS,
  Book,
  bibleData,
  chapterCount,
  label,
  verse,
  Verse,
} from './bible';
import { Rng, pick, shuffle } from './rng';
import {
  fitScore,
  isName as isNameWord,
  isRealPhrase,
  neighbours,
  normWord,
  sameTextRefs,
} from './corpus';

export type QuestionKind =
  | 'testament'
  | 'next'
  | 'before'
  | 'order'
  | 'finish'
  | 'missing'
  | 'book'
  | 'reference'
  | 'chapter'
  | 'related'
  | 'custom';

export const KIND_LABEL: Record<QuestionKind, string> = {
  testament: 'Old or New?',
  next: 'Book order',
  before: 'Book order',
  order: 'Book order',
  finish: 'Finish the verse',
  missing: 'Missing word',
  book: 'Which book?',
  reference: 'Which reference?',
  chapter: 'Which chapter?',
  related: 'Linked verses',
  custom: 'From your church',
};

export interface Question {
  // Identifies the question (not the option order), so a member isn't asked the same one again soon.
  key: string;
  kind: QuestionKind;
  prompt: string;
  // A verse shown with the question (which book / reference / chapter / linked).
  passage?: string;
  // Reference shown with the question, when it isn't what's being asked.
  ref?: string;
  options: string[];
  answer: number;
  // Shown after answering: the full verse with its reference, or a short fact.
  explain: string;
}

// How many of the best-known verses a question may draw from; 'all' means any verse in the Bible.
export type Band = number | 'all';

// Books most people can place: used for book-order questions at the starter levels.
const FAMILIAR = new Set([
  'GEN',
  'EXO',
  'LEV',
  'NUM',
  'DEU',
  'JOS',
  'JDG',
  'RUT',
  '1SA',
  '2SA',
  '1KI',
  '2KI',
  'PSA',
  'PRO',
  'ECC',
  'ISA',
  'JER',
  'DAN',
  'MAT',
  'MRK',
  'LUK',
  'JHN',
  'ACT',
  'ROM',
  '1CO',
  '2CO',
  'GAL',
  'EPH',
  'PHP',
  'COL',
  '1TI',
  '2TI',
  'HEB',
  'JAS',
  '1PE',
  '2PE',
  '1JN',
  'REV',
]);

const BLANK = '___';
const MAX_WORDS = 30;
const STOPWORDS = new Set(
  [
    'the and of to in that a is for unto he his i me my it be was with not they shall them all but ye you thou thee thy',
    'him as are which from by on have will this said there their when so an or at we us our also upon were then who',
    'what into her she out up no if hath had did do let may these those saith one any even every than because',
    'therefore wherefore thereof therein whom whose how why where being been shalt hast art wilt canst doth dost',
    'thine mine your yours ours very more most such same nor yet both each own over under again among through',
  ]
    .join(' ')
    .split(' '),
);
// Blanking a divine name invites "Jesus or Christ?" ambiguity, so these are never the missing word.
const NEVER_BLANK = new Set([
  'lord',
  'god',
  'jesus',
  'christ',
  'jehovah',
  'amen',
  'selah',
  'hallelujah',
]);

const clean = (w: string) => w.replace(/[^A-Za-z']/g, '');
const isContent = (w: string) => {
  const c = clean(w).toLowerCase();
  return c.length >= 3 && !STOPWORDS.has(c) && !NEVER_BLANK.has(c);
};
const suffixClass = (w: string) =>
  /eth$/.test(w)
    ? 'eth'
    : /est$/.test(w)
      ? 'est'
      : /ed$/.test(w)
        ? 'ed'
        : /ing$/.test(w)
          ? 'ing'
          : /ly$/.test(w)
            ? 'ly'
            : /s$/.test(w)
              ? 's'
              : 'base';
const capitalised = (w: string) => /^[A-Z]/.test(w);

interface WordPool {
  common: string[];
  // Never written in lower case: names and places.
  names: string[];
}

let wordPool: WordPool | null = null;

// Content words from well-known verses: wrong options that look like real Bible words.
function pool(): WordPool {
  if (wordPool) return wordPool;
  const lower = new Set<string>();
  const capital = new Set<string>();
  for (const ref of bibleData().popular.slice(0, 1500)) {
    for (const w of verse(ref)?.text.split(' ') ?? []) {
      if (!isContent(w)) continue;
      const c = clean(w);
      (capitalised(c) ? capital : lower).add(c);
    }
  }
  wordPool = {
    common: [...lower],
    names: [...capital].filter((w) => !lower.has(w.toLowerCase())),
  };
  return wordPool;
}

const titleCase = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

// Fallback when the sentence gives too little context: KJV words of the same form and similar length.
function poolWords(
  rng: Rng,
  answer: string,
  inVerse: Set<string>,
  count: number,
): string[] {
  const { common, names } = pool();
  const isName = capitalised(answer) && !common.includes(answer.toLowerCase());
  const cls = suffixClass(answer.toLowerCase());
  const source = isName ? names : common;
  return shuffle(
    rng,
    source.filter(
      (w) =>
        !inVerse.has(w.toLowerCase()) &&
        (isName || suffixClass(w) === cls) &&
        Math.abs(w.length - answer.length) <= 3,
    ),
  ).slice(0, count * 3);
}

// Wrong words that fit the sentence (seen next to the same words elsewhere in the KJV) but never form a real KJV
// phrase in this spot, so only the true word reads as right.
function wrongWords(rng: Rng, words: string[], index: number): string[] {
  const answer = clean(words[index]);
  const inVerse = new Set(words.map(normWord));
  const endsClause = /[.,:;?!]$/.test(words[index]);
  const before =
    index > 0 && !/[.:;?!]$/.test(words[index - 1])
      ? normWord(words[index - 1])
      : null;
  const after =
    !endsClause && index < words.length - 1 ? normWord(words[index + 1]) : null;
  const isName =
    capitalised(answer) && !pool().common.includes(answer.toLowerCase());
  const cls = suffixClass(answer.toLowerCase());

  const ranked = isName
    ? []
    : neighbours(before, after)
        .filter(
          (w) =>
            w !== answer.toLowerCase() &&
            !isNameWord(w) &&
            !inVerse.has(w) &&
            isContent(w) &&
            Math.abs(w.length - answer.length) <= 4 &&
            !(before && after && isRealPhrase(w, before, after)),
        )
        .map((w) => ({
          w,
          score:
            fitScore(w, before, after) * 2 +
            (suffixClass(w) === cls ? 1.5 : 0) +
            (Math.abs(w.length - answer.length) <= 2 ? 0.5 : 0),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 12)
        .map((x) => x.w);

  const candidates = [
    ...shuffle(rng, ranked),
    ...poolWords(rng, answer, inVerse, 3),
  ];
  const out: string[] = [];
  for (const w of candidates) {
    const word = capitalised(answer) && !isName ? titleCase(w) : w;
    if (out.some((o) => o.toLowerCase() === word.toLowerCase())) continue;
    if (before && after && isRealPhrase(word, before, after)) continue;
    out.push(word);
    if (out.length === 3) break;
  }
  return out;
}

function withOptions(
  rng: Rng,
  base: Omit<Question, 'options' | 'answer'>,
  right: string,
  wrong: string[],
): Question | null {
  const seen = new Set([right.toLowerCase()]);
  const distinct = wrong
    .filter((w) => {
      const k = w.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 3);
  if (distinct.length < 3) return null;
  const options = shuffle(rng, [right, ...distinct]);
  return { ...base, options, answer: options.indexOf(right) };
}

function pickVerse(rng: Rng, band: Band, maxWords?: number): Verse | null {
  const { popular, all } = bibleData();
  for (let tries = 0; tries < 20; tries++) {
    const v = verse(
      band === 'all' ? pick(rng, all) : pick(rng, popular.slice(0, band)),
    );
    if (v && (!maxWords || v.text.split(' ').length <= maxWords)) return v;
  }
  return null;
}

const fullVerse = (v: Verse) => `“${v.text}” (${label(v.ref)}, KJV)`;

function excerpt(text: string): string {
  const words = text.split(' ');
  return words.length <= MAX_WORDS
    ? text
    : `${words.slice(0, MAX_WORDS).join(' ')} …`;
}

// Blank one word of the verse, trimming long verses to a window around it.
function blanked(v: Verse, index: number): string {
  const words = v.text.split(' ');
  const w = words[index];
  const lead = w.match(/^[^A-Za-z']*/)?.[0] ?? '';
  const trail = w.match(/[^A-Za-z']*$/)?.[0] ?? '';
  words[index] = `${lead}${BLANK}${trail}`;
  if (words.length <= MAX_WORDS) return words.join(' ');
  const start = Math.max(0, index - 18);
  const end = Math.min(words.length, index + 6);
  return `${start > 0 ? '… ' : ''}${words.slice(start, end).join(' ')}${end < words.length ? ' …' : ''}`;
}

function wordQuestion(
  rng: Rng,
  band: Band,
  kind: 'finish' | 'missing',
  maxWords?: number,
): Question | null {
  const v = pickVerse(rng, band, maxWords);
  if (!v) return null;
  const words = v.text.split(' ');
  const content = words
    .map((w, i) => (isContent(w) ? i : -1))
    .filter((i) => i >= 0);
  if (content.length < 2) return null;
  const index =
    kind === 'finish'
      ? content[content.length - 1]
      : pick(rng, content.slice(0, -1));
  const right = clean(words[index]);
  return withOptions(
    rng,
    {
      key: `${kind}:${v.ref}:${index}`,
      kind,
      prompt: blanked(v, index),
      ref: label(v.ref),
      explain: fullVerse(v),
    },
    right,
    wrongWords(rng, words, index),
  );
}

function bookNames(books: Book[]): string[] {
  return books.map((b) => b.name);
}

function testament(rng: Rng, familiar: boolean): Question | null {
  const b = pick(
    rng,
    familiar ? BOOKS.filter((x) => FAMILIAR.has(x.code)) : BOOKS,
  );
  const options = ['Old Testament', 'New Testament'];
  return {
    key: `testament:${b.code}`,
    kind: 'testament',
    prompt: `Is the book of ${b.name} in the Old Testament or the New Testament?`,
    options,
    answer: b.testament === 'OT' ? 0 : 1,
    explain: `${b.name} is book ${b.index + 1} of 66, in the ${b.testament === 'OT' ? 'Old' : 'New'} Testament.`,
  };
}

function neighbour(
  rng: Rng,
  direction: 1 | -1,
  familiar: boolean,
): Question | null {
  const choices = BOOKS.filter((b) => {
    const other = BOOKS[b.index + direction];
    return (
      !!other &&
      (!familiar || (FAMILIAR.has(b.code) && FAMILIAR.has(other.code)))
    );
  });
  const from = pick(rng, choices);
  const right = BOOKS[from.index + direction];
  const near = BOOKS.filter(
    (b) =>
      b !== right &&
      b !== from &&
      Math.abs(b.index - from.index) <= 4 &&
      (!familiar || FAMILIAR.has(b.code)),
  );
  const kind = direction === 1 ? 'next' : 'before';
  return withOptions(
    rng,
    {
      key: `${kind}:${from.code}`,
      kind,
      prompt: `Which book comes right ${direction === 1 ? 'after' : 'before'} ${from.name}?`,
      explain:
        direction === 1
          ? `${from.name} is followed by ${right.name}.`
          : `${right.name} comes right before ${from.name}.`,
    },
    right.name,
    bookNames(shuffle(rng, near).slice(0, 3)),
  );
}

function order(rng: Rng): Question | null {
  const start = Math.floor(rng() * (BOOKS.length - 12));
  const books = shuffle(rng, BOOKS.slice(start, start + 12)).slice(0, 4);
  const first = books.reduce((a, b) => (b.index < a.index ? b : a));
  const sorted = [...books].sort((a, b) => a.index - b.index);
  return withOptions(
    rng,
    {
      key: `order:${sorted.map((b) => b.code).join(',')}`,
      kind: 'order',
      prompt: 'Which of these books comes first in the Bible?',
      explain: `In Bible order: ${sorted.map((b) => b.name).join(', ')}.`,
    },
    first.name,
    bookNames(books.filter((b) => b !== first)),
  );
}

// A verse found word for word elsewhere (Psalm 14 / 53, Kings / Isaiah) can't be placed with one right answer.
const hasTwin = (v: Verse) => sameTextRefs(v.ref).length > 0;

function whichBook(rng: Rng, band: Band): Question | null {
  const v = pickVerse(rng, band);
  if (!v || hasTwin(v)) return null;
  const sameGroup = BOOKS.filter(
    (b) => b.group === v.book.group && b !== v.book,
  );
  const sameTestament = BOOKS.filter(
    (b) =>
      b.testament === v.book.testament &&
      b !== v.book &&
      b.group !== v.book.group,
  );
  const wrong = [
    ...shuffle(rng, sameGroup).slice(0, 2),
    ...shuffle(rng, sameTestament),
  ].slice(0, 3);
  return withOptions(
    rng,
    {
      key: `book:${v.ref}`,
      kind: 'book',
      prompt: 'Which book is this verse from?',
      passage: excerpt(v.text),
      explain: fullVerse(v),
    },
    v.book.name,
    bookNames(wrong),
  );
}

function reference(rng: Rng, band: Band): Question | null {
  const v = pickVerse(rng, band);
  if (!v || hasTwin(v) || chapterCount(v.book.code) < 4) return null;
  const { kjv } = bibleData();
  const others = new Set<string>();
  for (let tries = 0; tries < 40 && others.size < 3; tries++) {
    const ch = v.chapter + Math.round((rng() - 0.5) * 8);
    const chapter = kjv[v.book.code][ch - 1];
    if (!chapter || ch === v.chapter) continue;
    const vs = Math.max(
      1,
      Math.min(chapter.length, v.verse + Math.round((rng() - 0.5) * 6)),
    );
    if (chapter[vs - 1]) others.add(`${v.book.code}.${ch}.${vs}`);
  }
  return withOptions(
    rng,
    {
      key: `reference:${v.ref}`,
      kind: 'reference',
      prompt: 'Which reference is this verse?',
      passage: excerpt(v.text),
      explain: fullVerse(v),
    },
    label(v.ref),
    [...others].map(label),
  );
}

function chapter(rng: Rng, band: Band): Question | null {
  const v = pickVerse(rng, band);
  const count = v ? chapterCount(v.book.code) : 0;
  if (!v || hasTwin(v) || count < 4) return null;
  const others = new Set<number>();
  for (let tries = 0; tries < 40 && others.size < 3; tries++) {
    const ch = v.chapter + Math.round((rng() - 0.5) * 8);
    if (ch >= 1 && ch <= count && ch !== v.chapter) others.add(ch);
  }
  return withOptions(
    rng,
    {
      key: `chapter:${v.ref}`,
      kind: 'chapter',
      prompt: `Which chapter of ${v.book.name} is this verse in?`,
      passage: excerpt(v.text),
      explain: fullVerse(v),
    },
    `Chapter ${v.chapter}`,
    [...others].map((c) => `Chapter ${c}`),
  );
}

function related(rng: Rng, band: Band): Question | null {
  const { popular, related: links } = bibleData();
  const scope = band === 'all' ? popular : popular.slice(0, band);
  const candidates = scope.filter((r) => links[r]?.length);
  if (!candidates.length) return null;
  const from = verse(pick(rng, candidates));
  if (!from) return null;
  const linked = links[from.ref];
  const to = verse(pick(rng, linked));
  if (!to) return null;
  const snippet = (v: Verse) => {
    const words = v.text.split(' ');
    return `${label(v.ref)}: “${words.slice(0, 9).join(' ')}${words.length > 9 ? ' …' : ''}”`;
  };
  const wrong: string[] = [];
  for (const r of shuffle(rng, popular.slice(0, 2000))) {
    const v = verse(r);
    if (!v || v.book === from.book || v.book === to.book || linked.includes(r))
      continue;
    wrong.push(snippet(v));
    if (wrong.length === 3) break;
  }
  return withOptions(
    rng,
    {
      key: `related:${from.ref}:${to.ref}`,
      kind: 'related',
      prompt: 'Which verse is most closely linked to this one?',
      passage: excerpt(from.text),
      ref: label(from.ref),
      explain: `${label(from.ref)} is often read with ${label(to.ref)}: “${to.text}”`,
    },
    snippet(to),
    wrong,
  );
}

export interface KindSpec {
  kind: QuestionKind;
  band?: Band;
  // Starter levels: only books most people know, and only shorter verses.
  familiar?: boolean;
  maxWords?: number;
}

export function makeQuestion(rng: Rng, spec: KindSpec): Question | null {
  const band = spec.band ?? 100;
  switch (spec.kind) {
    case 'testament':
      return testament(rng, !!spec.familiar);
    case 'next':
      return neighbour(rng, 1, !!spec.familiar);
    case 'before':
      return neighbour(rng, -1, !!spec.familiar);
    case 'order':
      return order(rng);
    case 'finish':
    case 'missing':
      return wordQuestion(rng, band, spec.kind, spec.maxWords);
    case 'book':
      return whichBook(rng, band);
    case 'reference':
      return reference(rng, band);
    case 'chapter':
      return chapter(rng, band);
    case 'related':
      return related(rng, band);
  }
}

// Questions built from given verses (e.g. those members noted this week), as finish / missing-word questions.
export function verseQuestion(rng: Rng, ref: string): Question | null {
  const v = verse(ref);
  if (!v) return null;
  const words = v.text.split(' ');
  const content = words
    .map((w, i) => (isContent(w) ? i : -1))
    .filter((i) => i >= 0);
  if (content.length < 2) return null;
  const index = pick(rng, content);
  const right = clean(words[index]);
  const kind = index === content[content.length - 1] ? 'finish' : 'missing';
  return withOptions(
    rng,
    {
      key: `${kind}:${v.ref}:${index}`,
      kind,
      prompt: blanked(v, index),
      ref: label(v.ref),
      explain: fullVerse(v),
    },
    right,
    wrongWords(rng, words, index),
  );
}

export interface CustomQuestionInput {
  id: string;
  prompt: string;
  options: string[];
  answer: number;
  explain: string | null;
}

// A church-written question, with its options shuffled like any other.
export function customQuestion(rng: Rng, c: CustomQuestionInput): Question {
  const order = shuffle(
    rng,
    c.options.map((_, i) => i),
  );
  return {
    key: `custom:${c.id}`,
    kind: 'custom',
    prompt: c.prompt,
    options: order.map((i) => c.options[i]),
    answer: order.indexOf(c.answer),
    explain: c.explain || `The answer is “${c.options[c.answer]}”.`,
  };
}

// Verse refs a question is about, read from its key ("finish:JHN.3.16:7", "related:A:B").
export function refsInKey(key: string): string[] {
  return key.split(':').filter((part) => /^[1-3A-Z]{3}\.\d+\.\d+$/.test(part));
}
