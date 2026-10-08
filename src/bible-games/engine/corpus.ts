import { BOOKS, bibleData } from './bible';

// Every word of the KJV in order (as numeric ids) with where each word occurs, built once and kept compact
// (typed arrays, a few MB) because the API runs on small machines. Used to pick wrong options that fit the
// sentence and to reject any that would also be right.
interface Corpus {
  ids: Map<string, number>;
  tokens: Uint32Array;
  // Positions of word id w are flat[offsets[w] .. offsets[w + 1]).
  offsets: Uint32Array;
  flat: Uint32Array;
  // Words only ever written with a capital: names and places.
  names: Set<string>;
  // ref -> refs with the same text, only for verses that have a word-for-word twin.
  twins: Map<string, string[]>;
  words: string[];
}

const BREAK = 0;
let corpus: Corpus | null = null;

export const normWord = (w: string) =>
  w.replace(/[^A-Za-z']/g, '').toLowerCase();
const normText = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function build(): Corpus {
  const { kjv } = bibleData();
  const ids = new Map<string, number>([['', BREAK]]);
  const words = [''];
  const lowerSeen = new Set<string>();
  const sequence: number[] = [];
  const firstRef = new Map<string, string>();
  const twins = new Map<string, string[]>();

  for (const b of BOOKS) {
    kjv[b.code].forEach((chapter, c) =>
      chapter.forEach((text, v) => {
        if (!text) return;
        const ref = `${b.code}.${c + 1}.${v + 1}`;
        const key = normText(text);
        const first = firstRef.get(key);
        if (first) {
          const group = [...(twins.get(first) ?? [first]), ref];
          for (const r of group) twins.set(r, group);
        } else {
          firstRef.set(key, ref);
        }
        for (const raw of text.split(' ')) {
          const w = normWord(raw);
          if (!w) continue;
          if (!/^[A-Z]/.test(raw.replace(/^[^A-Za-z]+/, ''))) lowerSeen.add(w);
          let id = ids.get(w);
          if (id === undefined) {
            id = words.length;
            ids.set(w, id);
            words.push(w);
          }
          sequence.push(id);
        }
        // Verse boundary, so words from two verses never count as a phrase.
        sequence.push(BREAK);
      }),
    );
  }

  const tokens = Uint32Array.from(sequence);
  const counts = new Uint32Array(words.length + 1);
  for (const id of tokens) counts[id + 1]++;
  const offsets = new Uint32Array(words.length + 1);
  for (let i = 1; i <= words.length; i++)
    offsets[i] = offsets[i - 1] + counts[i];
  const fill = offsets.slice();
  const flat = new Uint32Array(tokens.length);
  tokens.forEach((id, p) => (flat[fill[id]++] = p));

  const names = new Set(words.filter((w, i) => i > 0 && !lowerSeen.has(w)));
  return { ids, tokens, offsets, flat, names, twins, words };
}

function get(): Corpus {
  return (corpus ??= build());
}

function positionsOf(word: string): Uint32Array {
  const c = get();
  const id = c.ids.get(normWord(word));
  return id === undefined || id === BREAK
    ? new Uint32Array(0)
    : c.flat.subarray(c.offsets[id], c.offsets[id + 1]);
}

const idOf = (word: string | null) => (word ? get().ids.get(word) : undefined);

export function frequency(word: string): number {
  return positionsOf(word).length;
}

export function isName(word: string): boolean {
  return get().names.has(normWord(word));
}

// How well `candidate` fits between `before` and `after` in KJV usage: 2 = seen after `before` and before `after`.
export function fitScore(
  candidate: string,
  before: string | null,
  after: string | null,
): number {
  const { tokens } = get();
  const b = idOf(before);
  const a = idOf(after);
  let afterPrev = false;
  let beforeNext = false;
  for (const p of positionsOf(candidate)) {
    if (b !== undefined && tokens[p - 1] === b) afterPrev = true;
    if (a !== undefined && tokens[p + 1] === a) beforeNext = true;
    if (afterPrev && beforeNext) break;
  }
  return (afterPrev ? 1 : 0) + (beforeNext ? 1 : 0);
}

// True when "before candidate after" occurs somewhere in the KJV: the candidate could pass as a right answer.
export function isRealPhrase(
  candidate: string,
  before: string | null,
  after: string | null,
): boolean {
  const b = idOf(before);
  const a = idOf(after);
  if (b === undefined && a === undefined) return false;
  const { tokens } = get();
  for (const p of positionsOf(candidate)) {
    if (
      (b === undefined || tokens[p - 1] === b) &&
      (a === undefined || tokens[p + 1] === a)
    )
      return true;
  }
  return false;
}

// Words that follow `before` (or precede `after`) anywhere in the KJV.
export function neighbours(
  before: string | null,
  after: string | null,
): string[] {
  const { tokens, words } = get();
  const out = new Set<string>();
  if (before)
    for (const p of positionsOf(before))
      if (tokens[p + 1] !== BREAK) out.add(words[tokens[p + 1]]);
  if (after)
    for (const p of positionsOf(after))
      if (p > 0 && tokens[p - 1] !== BREAK) out.add(words[tokens[p - 1]]);
  return [...out];
}

// Other refs whose verse reads exactly the same (e.g. Psalm 14 and 53).
export function sameTextRefs(ref: string): string[] {
  return (get().twins.get(ref) ?? []).filter((r) => r !== ref);
}
