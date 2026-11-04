// Words that don't tell two organisations apart, so "Grace Church" and "Grace Ministries" compare as "grace".
const FILLER = new Set([
  'the',
  'of',
  'and',
  'church',
  'churches',
  'ministry',
  'ministries',
  'international',
  'global',
  'worldwide',
  'inc',
  'ltd',
]);
const ACRONYM_SKIP = new Set(['the', 'of', 'and']);
const MIN_SHORT_FORM = 3;
const MIN_PREFIX = 4;

export interface ProtectedEntry {
  name: string;
  shortForms: string[];
  addresses: string[];
}

const words = (text: string): string[] =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const compact = (text: string): string => words(text).join('');

export const coreName = (text: string): string =>
  words(text)
    .filter((w) => !FILLER.has(w))
    .join(' ');

export const acronym = (text: string): string =>
  words(text)
    .filter((w) => !ACRONYM_SKIP.has(w))
    .map((w) => w[0])
    .join('');

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

const allowedTypos = (length: number): number =>
  length >= 16 ? 2 : length >= 8 ? 1 : 0;

const shortKeys = (entry: ProtectedEntry): string[] =>
  [...entry.shortForms, ...entry.addresses, acronym(entry.name)]
    .map(compact)
    .filter((key) => key.length >= MIN_SHORT_FORM);

// Catches the same name reworded slightly, its initials, or a short form used as a word.
export function nameMatches(candidate: string, entry: ProtectedEntry): boolean {
  const core = coreName(candidate);
  const protectedCore = coreName(entry.name);
  if (core && protectedCore) {
    if (core === protectedCore) return true;
    const typos = allowedTypos(protectedCore.length);
    if (typos && editDistance(core, protectedCore) <= typos) return true;
  }
  const keys = shortKeys(entry);
  const candidateWords = words(candidate);
  return (
    keys.includes(acronym(candidate)) ||
    candidateWords.some((w) => keys.includes(w))
  );
}

// An address is reserved when it is, or starts with, a protected short form or the name itself.
export function addressMatches(
  address: string,
  entry: ProtectedEntry,
): boolean {
  const parts = address.toLowerCase().split('-');
  const whole = parts.join('');
  const keys = [...shortKeys(entry), compact(coreName(entry.name))].filter(
    Boolean,
  );
  return keys.some(
    (key) =>
      key === whole ||
      parts.includes(key) ||
      (key.length >= MIN_PREFIX && whole.startsWith(key)),
  );
}
