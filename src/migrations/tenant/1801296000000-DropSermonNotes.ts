import { MigrationInterface, QueryRunner } from 'typeorm';

// Sermon notes now live in `notes` (CreateNotes copied them). Names are schema-qualified because the tenant
// search_path also includes public, which still holds the pre-multi-tenant copy of this table.
export class DropSermonNotes1801296000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const schema = await this.schema(queryRunner);
    const [{ present }] = await queryRunner.query(
      `SELECT to_regclass($1) IS NOT NULL AS present`,
      [`"${schema}".sermon_notes`],
    );
    if (!present) return;

    // Never drop a note that didn't make it across.
    const [{ missing }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS missing
       FROM "${schema}".sermon_notes sn
       WHERE NOT EXISTS (
         SELECT 1 FROM "${schema}".notes n
         WHERE n.member_id = sn.member_id AND n.sermon_id = sn.sermon_id
       )`,
    );
    if (missing > 0) {
      throw new Error(
        `${schema}: ${missing} sermon note(s) are not in notes yet; sermon_notes was kept.`,
      );
    }
    await queryRunner.query(`DROP TABLE "${schema}".sermon_notes`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const schema = await this.schema(queryRunner);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".sermon_notes (
          id          UUID        NOT NULL DEFAULT gen_random_uuid(),
          sermon_id   UUID        NOT NULL,
          member_id   UUID        NOT NULL,
          note        TEXT        NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT sermon_notes_pkey PRIMARY KEY (id),
          CONSTRAINT "UQ_sermon_notes_sermon_member" UNIQUE (sermon_id, member_id),
          CONSTRAINT sermon_notes_member_id_fkey FOREIGN KEY (member_id) REFERENCES "${schema}".members(id) ON DELETE CASCADE,
          CONSTRAINT sermon_notes_sermon_id_fkey FOREIGN KEY (sermon_id) REFERENCES "${schema}".sermons(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sermon_notes_sermon_id" ON "${schema}".sermon_notes (sermon_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_sermon_notes_member_id ON "${schema}".sermon_notes (member_id)`,
    );
    // Restore each member's latest note per sermon as plain text.
    await queryRunner.query(`
      INSERT INTO "${schema}".sermon_notes (sermon_id, member_id, note, created_at, updated_at)
      SELECT DISTINCT ON (n.member_id, n.sermon_id) n.sermon_id, n.member_id, n.plain_text, n.created_at, n.updated_at
      FROM "${schema}".notes n
      WHERE n.sermon_id IS NOT NULL AND n.plain_text <> ''
      ORDER BY n.member_id, n.sermon_id, n.updated_at DESC
      ON CONFLICT (sermon_id, member_id) DO NOTHING
    `);
  }

  private async schema(queryRunner: QueryRunner): Promise<string> {
    const [{ schema }] = await queryRunner.query(
      `SELECT current_schema() AS schema`,
    );
    return schema;
  }
}
