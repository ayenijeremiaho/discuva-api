import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Book {
  code: string;
  name: string;
  index: number;
  testament: 'OT' | 'NT';
  group: string;
}

const NAMES: [string, string, string][] = [
  ['GEN', 'Genesis', 'law'],
  ['EXO', 'Exodus', 'law'],
  ['LEV', 'Leviticus', 'law'],
  ['NUM', 'Numbers', 'law'],
  ['DEU', 'Deuteronomy', 'law'],
  ['JOS', 'Joshua', 'history'],
  ['JDG', 'Judges', 'history'],
  ['RUT', 'Ruth', 'history'],
  ['1SA', '1 Samuel', 'history'],
  ['2SA', '2 Samuel', 'history'],
  ['1KI', '1 Kings', 'history'],
  ['2KI', '2 Kings', 'history'],
  ['1CH', '1 Chronicles', 'history'],
  ['2CH', '2 Chronicles', 'history'],
  ['EZR', 'Ezra', 'history'],
  ['NEH', 'Nehemiah', 'history'],
  ['EST', 'Esther', 'history'],
  ['JOB', 'Job', 'poetry'],
  ['PSA', 'Psalms', 'poetry'],
  ['PRO', 'Proverbs', 'poetry'],
  ['ECC', 'Ecclesiastes', 'poetry'],
  ['SNG', 'Song of Solomon', 'poetry'],
  ['ISA', 'Isaiah', 'major'],
  ['JER', 'Jeremiah', 'major'],
  ['LAM', 'Lamentations', 'major'],
  ['EZK', 'Ezekiel', 'major'],
  ['DAN', 'Daniel', 'major'],
  ['HOS', 'Hosea', 'minor'],
  ['JOL', 'Joel', 'minor'],
  ['AMO', 'Amos', 'minor'],
  ['OBA', 'Obadiah', 'minor'],
  ['JON', 'Jonah', 'minor'],
  ['MIC', 'Micah', 'minor'],
  ['NAM', 'Nahum', 'minor'],
  ['HAB', 'Habakkuk', 'minor'],
  ['ZEP', 'Zephaniah', 'minor'],
  ['HAG', 'Haggai', 'minor'],
  ['ZEC', 'Zechariah', 'minor'],
  ['MAL', 'Malachi', 'minor'],
  ['MAT', 'Matthew', 'gospel'],
  ['MRK', 'Mark', 'gospel'],
  ['LUK', 'Luke', 'gospel'],
  ['JHN', 'John', 'gospel'],
  ['ACT', 'Acts', 'history-nt'],
  ['ROM', 'Romans', 'paul'],
  ['1CO', '1 Corinthians', 'paul'],
  ['2CO', '2 Corinthians', 'paul'],
  ['GAL', 'Galatians', 'paul'],
  ['EPH', 'Ephesians', 'paul'],
  ['PHP', 'Philippians', 'paul'],
  ['COL', 'Colossians', 'paul'],
  ['1TH', '1 Thessalonians', 'paul'],
  ['2TH', '2 Thessalonians', 'paul'],
  ['1TI', '1 Timothy', 'paul'],
  ['2TI', '2 Timothy', 'paul'],
  ['TIT', 'Titus', 'paul'],
  ['PHM', 'Philemon', 'paul'],
  ['HEB', 'Hebrews', 'general'],
  ['JAS', 'James', 'general'],
  ['1PE', '1 Peter', 'general'],
  ['2PE', '2 Peter', 'general'],
  ['1JN', '1 John', 'general'],
  ['2JN', '2 John', 'general'],
  ['3JN', '3 John', 'general'],
  ['JUD', 'Jude', 'general'],
  ['REV', 'Revelation', 'prophecy-nt'],
];

export const BOOKS: Book[] = NAMES.map(([code, name, group], index) => ({
  code,
  name,
  index,
  testament: index < 39 ? 'OT' : 'NT',
  group,
}));
export const BOOK = new Map(BOOKS.map((b) => [b.code, b]));

export interface Verse {
  ref: string;
  book: Book;
  chapter: number;
  verse: number;
  text: string;
}

interface Data {
  kjv: Record<string, string[][]>;
  popular: string[];
  related: Record<string, string[]>;
  // Every verse ref in canonical order, for "any verse" picks at the hardest levels.
  all: string[];
}

let data: Data | null = null;

// Loaded once on first use; the files ship with the build (nest-cli assets).
export function bibleData(): Data {
  if (data) return data;
  const dir = join(__dirname, '..', 'data');
  const read = <T>(f: string): T =>
    JSON.parse(readFileSync(join(dir, f), 'utf8')) as T;
  const kjv = read<Record<string, string[][]>>('kjv.json');
  const all: string[] = [];
  for (const b of BOOKS) {
    kjv[b.code].forEach((ch, c) =>
      ch.forEach((t, v) => t && all.push(`${b.code}.${c + 1}.${v + 1}`)),
    );
  }
  data = {
    kjv,
    popular: read<string[]>('popular.json'),
    related: read<Record<string, string[]>>('related.json'),
    all,
  };
  return data;
}

export function verse(ref: string): Verse | null {
  const [code, c, v] = ref.split('.');
  const book = BOOK.get(code);
  const text = bibleData().kjv[code]?.[Number(c) - 1]?.[Number(v) - 1];
  if (!book || !text) return null;
  return { ref, book, chapter: Number(c), verse: Number(v), text };
}

export function chapterCount(code: string): number {
  return bibleData().kjv[code]?.length ?? 0;
}

export function verseCount(code: string, chapter: number): number {
  return bibleData().kjv[code]?.[chapter - 1]?.length ?? 0;
}

export function label(ref: string): string {
  const v = verse(ref);
  if (!v) return ref;
  // A single psalm is "Psalm 23:1"; the book is "Psalms".
  const name = v.book.code === 'PSA' ? 'Psalm' : v.book.name;
  return chapterCount(v.book.code) === 1
    ? `${name} ${v.verse}`
    : `${name} ${v.chapter}:${v.verse}`;
}
