import { MigrationInterface, QueryRunner } from 'typeorm';

interface Node {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
}

// Same rule as NotesService (wordCountOf), frozen here: words outside headings, so an untouched template counts as 0.
function words(doc: Node): number {
  const text = (n: Node): string =>
    n.type === 'text'
      ? (n.text ?? '')
      : n.type === 'scripture'
        ? String(n.attrs?.label ?? '')
        : (n.content ?? []).map(text).join(' ');
  return (doc.content ?? [])
    .filter((b) => b.type !== 'heading')
    .map(text)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

const BATCH = 500;

export class AddNoteWordCount1801382400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE notes ADD COLUMN IF NOT EXISTS word_count INT NOT NULL DEFAULT 0`,
    );
    for (let offset = 0; ; offset += BATCH) {
      const rows: { id: string; content: Node }[] = await queryRunner.query(
        `SELECT id, content FROM notes ORDER BY id LIMIT $1 OFFSET $2`,
        [BATCH, offset],
      );
      if (!rows.length) break;
      await queryRunner.query(
        `UPDATE notes n SET word_count = v.word_count
         FROM unnest($1::uuid[], $2::int[]) AS v(id, word_count)
         WHERE n.id = v.id`,
        [rows.map((r) => r.id), rows.map((r) => words(r.content))],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE notes DROP COLUMN IF EXISTS word_count`,
    );
  }
}
