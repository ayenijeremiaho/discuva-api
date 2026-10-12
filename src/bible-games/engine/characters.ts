import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOOK, BOOKS, bibleData, verse } from './bible';

export type Testament = 'OT' | 'NT';
export type Gender = 'male' | 'female';
export type Difficulty = 'easy' | 'medium' | 'hard';

export const ROLES = [
  'king',
  'queen',
  'prophet',
  'priest',
  'judge',
  'apostle',
  'patriarch',
  'warrior',
  'ruler',
  'shepherd',
  'fisherman',
  'missionary',
  'servant',
  'craftsman',
  'scribe',
  'tax_collector',
  'deacon',
  'pharisee',
] as const;
export type Role = (typeof ROLES)[number];

export const EVENTS = [
  'met_jesus',
  'angel',
  'miracles',
  'healed',
  'raised',
  'no_death',
  'dreams',
  'imprisoned',
  'killed',
  'egypt',
  'babylon_persia',
  'builder',
  'long_awaited_child',
  'promised_birth',
  'at_sea',
  'over_100',
  'anointed',
  'letters',
  'with_paul',
  'killer',
  'anointer',
  'baby_jesus',
] as const;
export type CharacterEvent = (typeof EVENTS)[number];

// "early" = before Abraham; "hebrew" = Israelite or Jew (including Abraham's family); anything else is another nation.
export type People = string;

export interface BibleCharacter {
  id: string;
  name: string;
  // The word matched in verses when the display name carries a qualifier ("Philip the evangelist" -> "Philip").
  term?: string;
  // Genuine other names (Abram, Cephas); also matched in verses.
  otherNames?: string[];
  // KJV spellings used in verses (Elias, Esaias); matched only.
  spellings?: string[];
  testament: Testament;
  gender: Gender;
  people: People;
  tribe?: string;
  roles: Role[];
  father?: string;
  mother?: string;
  spouses?: string[];
  children?: string[];
  siblings?: string[];
  // The Bible mentions a husband/wife or children, even if they aren't characters here.
  married?: boolean;
  parent?: boolean;
  events: CharacterEvent[];
  // Books (codes) where their story is told; each must contain one of their names.
  books: string[];
  bookNamed?: boolean;
  // OT characters named in the New Testament.
  namedInNT?: boolean;
  difficulty: Difficulty;
  summary: string;
  clues: string[];
}

export type QuestionGroup =
  'testament' | 'role' | 'family' | 'events' | 'books';

export const QUESTION_GROUPS: { id: QuestionGroup; label: string }[] = [
  { id: 'testament', label: 'Testament' },
  { id: 'role', label: 'Role' },
  { id: 'family', label: 'Family' },
  { id: 'events', label: 'Events' },
  { id: 'books', label: 'Books' },
];

export interface CharacterQuestion {
  id: string;
  group: QuestionGroup;
  text: string;
  test: (
    c: BibleCharacter,
    all: ReadonlyMap<string, BibleCharacter>,
  ) => boolean;
}

const has = (c: BibleCharacter, r: Role) => c.roles.includes(r);
const did = (c: BibleCharacter, e: CharacterEvent) => c.events.includes(e);
const inBooks = (c: BibleCharacter, codes: string[]) =>
  c.books.some((b) => codes.includes(b));
const range = (from: string, to: string) =>
  BOOKS.slice(BOOK.get(from)!.index, BOOK.get(to)!.index + 1).map(
    (b) => b.code,
  );
const isRoyal = (c?: BibleCharacter) =>
  !!c && (has(c, 'king') || has(c, 'queen'));
const parentsOf = (
  c: BibleCharacter,
  all: ReadonlyMap<string, BibleCharacter>,
) => [c.father, c.mother].flatMap((id) => (id ? [all.get(id)] : []));

export const isMarried = (c: BibleCharacter) =>
  c.married ?? (c.spouses?.length ?? 0) > 0;
export const isParent = (c: BibleCharacter) =>
  c.parent ?? (c.children?.length ?? 0) > 0;

// Every question is a pure function of a character's details, so the game can answer it without a human.
export const CHARACTER_QUESTIONS: CharacterQuestion[] = [
  {
    id: 'ot',
    group: 'testament',
    text: 'Are they from the Old Testament?',
    test: (c) => c.testament === 'OT',
  },
  {
    id: 'early',
    group: 'testament',
    text: 'Did they live before Abraham (Adam to Noah)?',
    test: (c) => c.people === 'early',
  },
  {
    id: 'israelite',
    group: 'testament',
    text: 'Were they an Israelite or a Jew?',
    test: (c) => c.people === 'hebrew',
  },
  {
    id: 'gentile',
    group: 'testament',
    text: 'Were they from another nation (not Israelite or Jewish)?',
    test: (c) => c.people !== 'hebrew' && c.people !== 'early',
  },
  {
    id: 'tribe_judah',
    group: 'testament',
    text: 'Were they from the tribe of Judah?',
    test: (c) => c.tribe === 'judah',
  },
  {
    id: 'tribe_benjamin',
    group: 'testament',
    text: 'Were they from the tribe of Benjamin?',
    test: (c) => c.tribe === 'benjamin',
  },
  {
    id: 'tribe_levi',
    group: 'testament',
    text: 'Were they from the tribe of Levi?',
    test: (c) => c.tribe === 'levi',
  },
  {
    id: 'named_nt',
    group: 'testament',
    text: 'Are they named in the New Testament?',
    test: (c) => c.testament === 'NT' || !!c.namedInNT,
  },

  {
    id: 'woman',
    group: 'role',
    text: 'Are they a woman?',
    test: (c) => c.gender === 'female',
  },
  {
    id: 'king',
    group: 'role',
    text: 'Were they a king?',
    test: (c) => has(c, 'king'),
  },
  {
    id: 'queen',
    group: 'role',
    text: 'Were they a queen?',
    test: (c) => has(c, 'queen'),
  },
  {
    id: 'prophet',
    group: 'role',
    text: 'Were they a prophet or prophetess?',
    test: (c) => has(c, 'prophet'),
  },
  {
    id: 'priest',
    group: 'role',
    text: 'Were they a priest or high priest?',
    test: (c) => has(c, 'priest'),
  },
  {
    id: 'judge',
    group: 'role',
    text: "Were they one of Israel's judges?",
    test: (c) => has(c, 'judge'),
  },
  {
    id: 'apostle',
    group: 'role',
    text: 'Were they one of the apostles?',
    test: (c) => has(c, 'apostle'),
  },
  {
    id: 'patriarch',
    group: 'role',
    text: "Were they one of Israel's founding fathers or mothers (Abraham, Isaac, Jacob and their wives)?",
    test: (c) => has(c, 'patriarch'),
  },
  {
    id: 'warrior',
    group: 'role',
    text: 'Were they a soldier, army commander or warrior?',
    test: (c) => has(c, 'warrior'),
  },
  {
    id: 'ruler',
    group: 'role',
    text: 'Were they a governor, official or ruler (not a king or queen)?',
    test: (c) => has(c, 'ruler'),
  },
  {
    id: 'shepherd',
    group: 'role',
    text: 'Did they look after sheep or flocks?',
    test: (c) => has(c, 'shepherd'),
  },
  {
    id: 'fisherman',
    group: 'role',
    text: 'Were they a fisherman?',
    test: (c) => has(c, 'fisherman'),
  },
  {
    id: 'missionary',
    group: 'role',
    text: 'Did they travel to spread the gospel?',
    test: (c) => has(c, 'missionary'),
  },
  {
    id: 'servant',
    group: 'role',
    text: 'Were they a servant or slave?',
    test: (c) => has(c, 'servant'),
  },
  {
    id: 'craftsman',
    group: 'role',
    text: 'Did they work with their hands (carpenter, tentmaker, craftsman)?',
    test: (c) => has(c, 'craftsman'),
  },
  {
    id: 'scribe',
    group: 'role',
    text: "Were they a scribe or teacher of God's law?",
    test: (c) => has(c, 'scribe'),
  },
  {
    id: 'tax_collector',
    group: 'role',
    text: 'Were they a tax collector?',
    test: (c) => has(c, 'tax_collector'),
  },
  {
    id: 'pharisee',
    group: 'role',
    text: 'Were they a Pharisee?',
    test: (c) => has(c, 'pharisee'),
  },
  {
    id: 'deacon',
    group: 'role',
    text: 'Were they one of the seven chosen to serve the early church?',
    test: (c) => has(c, 'deacon'),
  },

  {
    id: 'married',
    group: 'family',
    text: 'Does the Bible mention their husband or wife?',
    test: isMarried,
  },
  {
    id: 'parent',
    group: 'family',
    text: 'Does the Bible mention their children?',
    test: isParent,
  },
  {
    id: 'known_parent',
    group: 'family',
    text: 'Is their mother or father a well-known Bible character too?',
    test: (c) => !!(c.father || c.mother),
  },
  {
    id: 'known_sibling',
    group: 'family',
    text: 'Is their brother or sister a well-known Bible character too?',
    test: (c) => (c.siblings?.length ?? 0) > 0,
  },
  {
    id: 'known_child',
    group: 'family',
    text: 'Is their son or daughter a well-known Bible character too?',
    test: (c) => (c.children?.length ?? 0) > 0,
  },
  {
    id: 'known_spouse',
    group: 'family',
    text: 'Is their husband or wife a well-known Bible character too?',
    test: (c) => (c.spouses?.length ?? 0) > 0,
  },
  {
    id: 'royal_parent',
    group: 'family',
    text: 'Was their father or mother a king or queen?',
    test: (c, all) => parentsOf(c, all).some(isRoyal),
  },
  {
    id: 'royal_child',
    group: 'family',
    text: 'Did their son or daughter become a king or queen?',
    test: (c, all) => (c.children ?? []).some((id) => isRoyal(all.get(id))),
  },
  {
    id: 'other_name',
    group: 'family',
    text: 'Were they known by another name too?',
    test: (c) => (c.otherNames?.length ?? 0) > 0,
  },

  {
    id: 'met_jesus',
    group: 'events',
    text: 'Did they meet Jesus during his life on earth?',
    test: (c) => did(c, 'met_jesus'),
  },
  {
    id: 'angel',
    group: 'events',
    text: 'Did they see or speak with an angel?',
    test: (c) => did(c, 'angel'),
  },
  {
    id: 'miracles',
    group: 'events',
    text: 'Did God work miracles through them?',
    test: (c) => did(c, 'miracles'),
  },
  {
    id: 'healed',
    group: 'events',
    text: 'Were they healed by God?',
    test: (c) => did(c, 'healed'),
  },
  {
    id: 'raised',
    group: 'events',
    text: 'Were they brought back to life after dying?',
    test: (c) => did(c, 'raised'),
  },
  {
    id: 'no_death',
    group: 'events',
    text: 'Were they taken to heaven without dying?',
    test: (c) => did(c, 'no_death'),
  },
  {
    id: 'dreams',
    group: 'events',
    text: 'Did they have a dream from God, or explain one?',
    test: (c) => did(c, 'dreams'),
  },
  {
    id: 'imprisoned',
    group: 'events',
    text: 'Were they put in prison or chains?',
    test: (c) => did(c, 'imprisoned'),
  },
  {
    id: 'killed',
    group: 'events',
    text: 'Were they killed or put to death?',
    test: (c) => did(c, 'killed'),
  },
  {
    id: 'egypt',
    group: 'events',
    text: 'Did they live in Egypt for a time?',
    test: (c) => did(c, 'egypt'),
  },
  {
    id: 'babylon_persia',
    group: 'events',
    text: 'Did they live in Babylon or Persia?',
    test: (c) => did(c, 'babylon_persia'),
  },
  {
    id: 'builder',
    group: 'events',
    text: 'Did they build something famous?',
    test: (c) => did(c, 'builder'),
  },
  {
    id: 'long_awaited_child',
    group: 'events',
    text: 'Did they wait many years for a child?',
    test: (c) => did(c, 'long_awaited_child'),
  },
  {
    id: 'promised_birth',
    group: 'events',
    text: 'Did God promise their birth before they were born?',
    test: (c) => did(c, 'promised_birth'),
  },
  {
    id: 'at_sea',
    group: 'events',
    text: 'Do they have a famous story on the sea or in a flood?',
    test: (c) => did(c, 'at_sea'),
  },
  {
    id: 'over_100',
    group: 'events',
    text: 'Did they live to be over 100?',
    test: (c) => did(c, 'over_100'),
  },
  {
    id: 'anointed',
    group: 'events',
    text: 'Were they anointed as king?',
    test: (c) => did(c, 'anointed'),
  },
  {
    id: 'letters',
    group: 'events',
    text: 'Did they write a letter in the New Testament?',
    test: (c) => did(c, 'letters'),
  },
  {
    id: 'with_paul',
    group: 'events',
    text: 'Did they travel with Paul?',
    test: (c) => did(c, 'with_paul'),
  },
  {
    id: 'killer',
    group: 'events',
    text: 'Did they kill someone with their own hands?',
    test: (c) => did(c, 'killer'),
  },
  {
    id: 'anointer',
    group: 'events',
    text: 'Did they anoint someone with oil or ointment?',
    test: (c) => did(c, 'anointer'),
  },
  {
    id: 'baby_jesus',
    group: 'events',
    text: 'Did they see Jesus when he was a baby?',
    test: (c) => did(c, 'baby_jesus'),
  },

  {
    id: 'genesis',
    group: 'books',
    text: 'Is their story told in Genesis?',
    test: (c) => inBooks(c, ['GEN']),
  },
  {
    id: 'law',
    group: 'books',
    text: 'Is their story told in Exodus, Leviticus, Numbers or Deuteronomy?',
    test: (c) => inBooks(c, ['EXO', 'LEV', 'NUM', 'DEU']),
  },
  {
    id: 'jos_rut',
    group: 'books',
    text: 'Is their story told in Joshua, Judges or Ruth?',
    test: (c) => inBooks(c, ['JOS', 'JDG', 'RUT']),
  },
  {
    id: 'kings',
    group: 'books',
    text: 'Is their story told in Samuel, Kings or Chronicles?',
    test: (c) => inBooks(c, range('1SA', '2CH')),
  },
  {
    id: 'ezr_est',
    group: 'books',
    text: 'Is their story told in Ezra, Nehemiah or Esther?',
    test: (c) => inBooks(c, ['EZR', 'NEH', 'EST']),
  },
  {
    id: 'prophets',
    group: 'books',
    text: 'Is their story told in one of the prophets (Isaiah to Malachi)?',
    test: (c) => inBooks(c, range('ISA', 'MAL')),
  },
  {
    id: 'gospels',
    group: 'books',
    text: 'Is their story told in the Gospels?',
    test: (c) => inBooks(c, ['MAT', 'MRK', 'LUK', 'JHN']),
  },
  {
    id: 'acts',
    group: 'books',
    text: 'Is their story told in Acts?',
    test: (c) => inBooks(c, ['ACT']),
  },
  {
    id: 'nt_letters',
    group: 'books',
    text: 'Are they named in the letters or Revelation?',
    test: (c) => inBooks(c, range('ROM', 'REV')),
  },
  {
    id: 'book_named',
    group: 'books',
    text: 'Is a book of the Bible named after them?',
    test: (c) => !!c.bookNamed,
  },
];

export const QUESTION = new Map(CHARACTER_QUESTIONS.map((q) => [q.id, q]));

let cache: {
  list: BibleCharacter[];
  byId: Map<string, BibleCharacter>;
} | null = null;

// Loaded once; the file ships with the build (nest-cli assets), like kjv.json.
export function characterData() {
  if (cache) return cache;
  const list = JSON.parse(
    readFileSync(join(__dirname, '..', 'data', 'characters.json'), 'utf8'),
  ) as BibleCharacter[];
  cache = { list, byId: new Map(list.map((c) => [c.id, c])) };
  return cache;
}

export function answer(
  questionId: string,
  c: BibleCharacter,
  all: ReadonlyMap<string, BibleCharacter> = characterData().byId,
): boolean {
  const q = QUESTION.get(questionId);
  if (!q) throw new Error(`Unknown question ${questionId}`);
  return q.test(c, all);
}

export function answerKey(
  c: BibleCharacter,
  all: ReadonlyMap<string, BibleCharacter>,
): string {
  return CHARACTER_QUESTIONS.map((q) => (q.test(c, all) ? '1' : '0')).join('');
}

export function matchTerms(c: BibleCharacter): string[] {
  return [c.term ?? c.name, ...(c.otherNames ?? []), ...(c.spellings ?? [])];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function mentions(text: string, terms: string[]): boolean {
  return terms.some((t) =>
    new RegExp(`(^|[^A-Za-z])${escape(t)}(?![A-Za-z])`, 'i').test(text),
  );
}

// Replaces the character's names with a blank so a clue verse hints without giving the answer away.
export function maskNames(text: string, terms: string[]): string {
  return [...terms]
    .sort((a, b) => b.length - a.length)
    .reduce(
      (out, t) =>
        out.replace(
          new RegExp(`(^|[^A-Za-z])${escape(t)}(?![A-Za-z])`, 'gi'),
          '$1___',
        ),
      text,
    );
}

function bookText(code: string): string {
  return (bibleData().kjv[code] ?? []).flat().join(' ');
}

// Problems with the character list; empty means every rule holds. Run by the engine spec.
export function validateCharacters(list: BibleCharacter[]): string[] {
  const problems: string[] = [];
  const byId = new Map(list.map((c) => [c.id, c]));
  const say = (c: BibleCharacter, msg: string) =>
    problems.push(`${c.id}: ${msg}`);
  const names = new Set<string>();
  const ntText = range('MAT', 'REV').map(bookText).join(' ');

  if (byId.size !== list.length) problems.push('duplicate ids');
  for (const c of list) {
    if (!/^[a-z0-9_]+$/.test(c.id)) say(c, 'id must be lowercase snake_case');
    if (names.has(c.name.toLowerCase())) say(c, 'duplicate display name');
    names.add(c.name.toLowerCase());
    for (const r of c.roles)
      if (!ROLES.includes(r)) say(c, `unknown role ${r}`);
    for (const e of c.events)
      if (!EVENTS.includes(e)) say(c, `unknown event ${e}`);
    if (!['easy', 'medium', 'hard'].includes(c.difficulty))
      say(c, 'bad difficulty');
    if (!c.summary || c.summary.length > 160)
      say(c, 'summary must be 1–160 characters');

    const terms = matchTerms(c);
    if (c.clues.length < 2 || c.clues.length > 3) say(c, 'needs 2–3 clues');
    if (new Set(c.clues).size !== c.clues.length) say(c, 'repeated clue');
    for (const ref of c.clues) {
      const v = verse(ref);
      if (!v) say(c, `clue ${ref} is not a KJV verse`);
      else if (!mentions(v.text, terms))
        say(c, `clue ${ref} doesn't name them`);
    }

    if (!c.books.length) say(c, 'needs at least one book');
    for (const code of c.books) {
      if (!BOOK.has(code)) say(c, `unknown book ${code}`);
      else if (!mentions(bookText(code), terms)) say(c, `not named in ${code}`);
    }
    const testaments = new Set(c.books.map((b) => BOOK.get(b)?.testament));
    if (!testaments.has(c.testament))
      say(c, `no ${c.testament} book in their story`);
    if (c.testament === 'OT') {
      if (
        c.events.some((e) =>
          ['met_jesus', 'letters', 'with_paul', 'baby_jesus'].includes(e),
        )
      )
        say(c, 'NT-only event on an OT character');
      if (has(c, 'apostle')) say(c, 'OT apostle');
      if (c.namedInNT && !mentions(ntText, terms))
        say(c, 'namedInNT but not found in the New Testament');
    } else if (c.namedInNT !== undefined) {
      say(c, 'namedInNT is only for OT characters');
    }
    if (c.people === 'early' && c.testament !== 'OT') say(c, 'early but NT');
    if (
      c.bookNamed &&
      !BOOKS.some((b) => terms.some((t) => b.name.includes(t)))
    )
      say(c, 'bookNamed but no book has their name');

    const link = (id: string | undefined, what: string) => {
      if (id && !byId.has(id)) say(c, `${what} ${id} isn't a character`);
      if (id === c.id) say(c, `${what} is themselves`);
    };
    link(c.father, 'father');
    link(c.mother, 'mother');
    for (const id of c.spouses ?? []) link(id, 'spouse');
    for (const id of c.children ?? []) link(id, 'child');
    for (const id of c.siblings ?? []) link(id, 'sibling');
    if (c.father && byId.get(c.father)?.gender !== 'male')
      say(c, 'father must be male');
    if (c.mother && byId.get(c.mother)?.gender !== 'female')
      say(c, 'mother must be female');

    // Family links run both ways.
    for (const id of c.children ?? []) {
      const child = byId.get(id);
      if (child && child.father !== c.id && child.mother !== c.id)
        say(c, `child ${id} doesn't list them as a parent`);
    }
    for (const id of [c.father, c.mother]) {
      const p = id ? byId.get(id) : undefined;
      if (p && !(p.children ?? []).includes(c.id))
        say(c, `parent ${id} doesn't list them as a child`);
    }
    for (const id of c.spouses ?? []) {
      const s = byId.get(id);
      if (s && !(s.spouses ?? []).includes(c.id))
        say(c, `spouse ${id} doesn't list them`);
    }
    for (const id of c.siblings ?? []) {
      const s = byId.get(id);
      if (s && !(s.siblings ?? []).includes(c.id))
        say(c, `sibling ${id} doesn't list them`);
    }
  }

  // Every character can be told apart by the questions.
  const keys = new Map<string, string>();
  for (const c of list) {
    const key = answerKey(c, byId);
    const other = keys.get(key);
    if (other) problems.push(`${other} and ${c.id} give identical answers`);
    else keys.set(key, c.id);
  }
  // Every question is worth asking: at least two yes and two no.
  for (const q of CHARACTER_QUESTIONS) {
    const yes = list.filter((c) => q.test(c, byId)).length;
    if (yes < 2 || list.length - yes < 2)
      problems.push(`question ${q.id} splits ${yes}/${list.length - yes}`);
  }
  return problems;
}
