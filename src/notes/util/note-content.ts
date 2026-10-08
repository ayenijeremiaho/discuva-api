// Notes are stored as the editor's (Tiptap/ProseMirror) JSON document; these helpers read it without trusting the client.

export interface NoteNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: NoteNode[];
}

export const NOTE_CONTENT_MAX_BYTES = 200_000;
export const NOTE_PLAIN_TEXT_MAX = 50_000;
export const COMMITMENT_MAX = 200;
export const SCRIPTURE_REFS_MAX = 100;

// USFM book codes, in canonical order.
export const BOOK_CODES = [
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
  '1CH',
  '2CH',
  'EZR',
  'NEH',
  'EST',
  'JOB',
  'PSA',
  'PRO',
  'ECC',
  'SNG',
  'ISA',
  'JER',
  'LAM',
  'EZK',
  'DAN',
  'HOS',
  'JOL',
  'AMO',
  'OBA',
  'JON',
  'MIC',
  'NAM',
  'HAB',
  'ZEP',
  'HAG',
  'ZEC',
  'MAL',
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
  '1TH',
  '2TH',
  '1TI',
  '2TI',
  'TIT',
  'PHM',
  'HEB',
  'JAS',
  '1PE',
  '2PE',
  '1JN',
  '2JN',
  '3JN',
  'JUD',
  'REV',
] as const;

const BOOKS = new Set<string>(BOOK_CODES);
const REF_PATTERN = /^([1-3A-Z]{3})\.(\d{1,3})(?:\.(\d{1,3})(?:-(\d{1,3}))?)?$/;

// "JHN.3.16-18", "JHN.3.16" or "JHN.3".
export function isScriptureRef(ref: unknown): ref is string {
  if (typeof ref !== 'string') return false;
  const m = REF_PATTERN.exec(ref);
  if (!m || !BOOKS.has(m[1])) return false;
  const [, , chapter, from, to] = m;
  if (Number(chapter) < 1) return false;
  if (from && Number(from) < 1) return false;
  return !(to && Number(to) <= Number(from));
}

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'listItem',
  'blockquote',
  'taskItem',
]);

function textOf(node: NoteNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'scripture') return String(node.attrs?.label ?? '');
  if (node.type === 'hardBreak') return '\n';
  const inner = (node.content ?? []).map(textOf).join('');
  return BLOCK_TYPES.has(node.type ?? '') ? `${inner}\n` : inner;
}

export function plainTextOf(doc: NoteNode): string {
  return textOf(doc)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, NOTE_PLAIN_TEXT_MAX);
}

export function scriptureRefsOf(doc: NoteNode): string[] {
  const refs = new Set<string>();
  const walk = (node: NoteNode) => {
    if (refs.size >= SCRIPTURE_REFS_MAX) return;
    if (node.type === 'scripture' && isScriptureRef(node.attrs?.ref)) {
      refs.add(node.attrs.ref);
    }
    node.content?.forEach(walk);
  };
  walk(doc);
  return [...refs];
}

// Text under the guided template's "One thing I'll do this week" heading, up to the next heading.
// Words the member wrote, leaving out headings (the guided template's prompts).
export function wordCountOf(doc: NoteNode): number {
  return (doc.content ?? [])
    .filter((b) => b.type !== 'heading')
    .map(textOf)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

export function commitmentOf(doc: NoteNode): string | null {
  const blocks = doc.content ?? [];
  const start = blocks.findIndex(
    (b) => b.type === 'heading' && b.attrs?.promptId === 'action',
  );
  if (start === -1) return null;
  const parts: string[] = [];
  for (const block of blocks.slice(start + 1)) {
    if (block.type === 'heading') break;
    parts.push(textOf(block));
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, COMMITMENT_MAX) : null;
}

export function docFromPlainText(text: string): NoteNode {
  return {
    type: 'doc',
    content: text
      .split(/\r?\n/)
      .map((line) =>
        line
          ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
          : { type: 'paragraph' },
      ),
  };
}

export function isNoteDoc(value: unknown): value is NoteNode {
  if (!value || typeof value !== 'object') return false;
  const doc = value as NoteNode;
  return (
    doc.type === 'doc' &&
    (doc.content === undefined || Array.isArray(doc.content))
  );
}
