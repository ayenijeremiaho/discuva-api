import { BibleCharacter } from './characters';
import { BOOK, label, verse } from './bible';

export interface RevealedCharacter {
  id: string;
  name: string;
  otherNames: string[];
  summary: string;
  clues: { label: string; text: string }[];
  books: string[];
}

// The church's clue verses for a character (its own edits, or the shipped ones).
export function cluesFor(
  character: BibleCharacter,
  pool: BibleCharacter[],
): string[] {
  return pool.find((c) => c.id === character.id)?.clues ?? character.clues;
}

// Who it was, shown once a game is over: the church's summary and the clue verses in full.
export function revealCharacter(
  character: BibleCharacter,
  pool: BibleCharacter[],
): RevealedCharacter {
  return {
    id: character.id,
    name: character.name,
    otherNames: character.otherNames ?? [],
    summary:
      pool.find((c) => c.id === character.id)?.summary ?? character.summary,
    clues: cluesFor(character, pool).map((ref) => ({
      label: label(ref),
      text: verse(ref)?.text ?? '',
    })),
    books: character.books.map((b) => BOOK.get(b)?.name ?? b),
  };
}
