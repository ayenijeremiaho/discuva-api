import {
  commitmentOf,
  docFromPlainText,
  isNoteDoc,
  isScriptureRef,
  wordCountOf,
  NoteNode,
  plainTextOf,
  scriptureRefsOf,
} from './note-content';

const p = (...content: NoteNode[]): NoteNode => ({
  type: 'paragraph',
  content,
});
const t = (text: string): NoteNode => ({ type: 'text', text });
const h = (text: string, promptId?: string): NoteNode => ({
  type: 'heading',
  attrs: { level: 3, ...(promptId ? { promptId } : {}) },
  content: [t(text)],
});
const verse = (ref: string, label: string): NoteNode => ({
  type: 'scripture',
  attrs: { ref, label, version: 'KJV' },
});

describe('note-content', () => {
  it('accepts canonical scripture refs and rejects bad ones', () => {
    ['JHN.3.16', 'JHN.3.16-18', 'PSA.23', '1CO.13.4'].forEach((r) =>
      expect(isScriptureRef(r)).toBe(true),
    );
    [
      'JOH.3.16',
      'JHN.0',
      'JHN.3.18-16',
      'JHN.3.16-16',
      'jhn.3.16',
      'JHN 3:16',
      42,
    ].forEach((r) => expect(isScriptureRef(r)).toBe(false));
  });

  it('extracts readable text including verse labels', () => {
    const doc: NoteNode = {
      type: 'doc',
      content: [
        h('Main scripture'),
        p(verse('ROM.8.28', 'Romans 8:28'), t(' all things')),
        p(),
      ],
    };
    expect(plainTextOf(doc)).toBe('Main scripture\nRomans 8:28 all things');
  });

  it('collects unique valid refs only', () => {
    const doc: NoteNode = {
      type: 'doc',
      content: [
        p(verse('ROM.8.28', 'Romans 8:28')),
        p(verse('ROM.8.28', 'Romans 8:28'), verse('BAD', 'x')),
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [p(verse('GEN.50.20', 'Genesis 50:20'))],
            },
          ],
        },
      ],
    };
    expect(scriptureRefsOf(doc)).toEqual(['ROM.8.28', 'GEN.50.20']);
  });

  it('reads the commitment under the action prompt up to the next heading', () => {
    const doc: NoteNode = {
      type: 'doc',
      content: [
        h('What stood out', 'points'),
        p(t('Grace')),
        h("One thing I'll do this week", 'action'),
        p(t('Call my mum')),
        p(t('every evening')),
        h('A question I have', 'question'),
        p(t('Why?')),
      ],
    };
    expect(commitmentOf(doc)).toBe('Call my mum every evening');
  });

  it('returns no commitment when the prompt is missing or empty', () => {
    expect(commitmentOf({ type: 'doc', content: [p(t('hi'))] })).toBeNull();
    expect(
      commitmentOf({
        type: 'doc',
        content: [h('Do', 'action'), p(), h('Next')],
      }),
    ).toBeNull();
  });

  it('round-trips plain text into paragraphs', () => {
    const doc = docFromPlainText('line one\n\nline three');
    expect(doc.content).toHaveLength(3);
    expect(doc.content?.[1]).toEqual({ type: 'paragraph' });
    expect(plainTextOf(doc)).toBe('line one\n\nline three');
  });

  it('only accepts a document node', () => {
    expect(isNoteDoc({ type: 'doc', content: [] })).toBe(true);
    expect(isNoteDoc({ type: 'doc' })).toBe(true);
    expect(isNoteDoc({ type: 'paragraph' })).toBe(false);
    expect(isNoteDoc({ type: 'doc', content: 'x' })).toBe(false);
    expect(isNoteDoc(null)).toBe(false);
  });

  it('counts only words the member wrote, not template headings', () => {
    const untouched: NoteNode = {
      type: 'doc',
      content: [
        h('Main scripture', 'scripture'),
        p(),
        h('My prayer', 'prayer'),
        p(),
      ],
    };
    expect(wordCountOf(untouched)).toBe(0);
    expect(
      wordCountOf({
        type: 'doc',
        content: [
          h('Main scripture'),
          p(verse('ROM.8.28', 'Romans 8:28'), t(' all things')),
        ],
      }),
    ).toBe(4);
  });
});
