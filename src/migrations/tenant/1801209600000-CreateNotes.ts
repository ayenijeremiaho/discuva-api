import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotes1801209600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notes (
          id               UUID              NOT NULL DEFAULT gen_random_uuid(),
          member_id        UUID              NOT NULL,
          kind             CHARACTER VARYING NOT NULL DEFAULT 'personal',
          title            CHARACTER VARYING(200) NOT NULL DEFAULT '',
          content          JSONB             NOT NULL,
          plain_text       TEXT              NOT NULL DEFAULT '',
          scripture_refs   JSONB             NOT NULL DEFAULT '[]',
          commitment       CHARACTER VARYING(200),
          sermon_id        UUID,
          event_id         UUID,
          service_slot_id  UUID,
          pinned           BOOLEAN           NOT NULL DEFAULT false,
          created_at       TIMESTAMPTZ       NOT NULL DEFAULT now(),
          updated_at       TIMESTAMPTZ       NOT NULL DEFAULT now(),
          CONSTRAINT "PK_notes" PRIMARY KEY (id),
          CONSTRAINT "FK_notes_member" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
          CONSTRAINT "FK_notes_sermon" FOREIGN KEY (sermon_id) REFERENCES sermons(id) ON DELETE SET NULL,
          CONSTRAINT "FK_notes_event" FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
          CONSTRAINT "FK_notes_service_slot" FOREIGN KEY (service_slot_id) REFERENCES service_slots(id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_notes_member_updated" ON notes (member_id, updated_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_notes_sermon_id" ON notes (sermon_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_notes_event_id" ON notes (event_id)`,
    );
    // One note per member per service, so "Start my notes" always reopens the same one.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_notes_member_service_slot" ON notes (member_id, service_slot_id) WHERE service_slot_id IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scripture_link_taps (
          day      DATE                  NOT NULL,
          version  CHARACTER VARYING(16) NOT NULL,
          count    INT                   NOT NULL DEFAULT 0,
          CONSTRAINT "PK_scripture_link_taps" PRIMARY KEY (day, version)
      )
    `);

    await queryRunner.query(
      `ALTER TABLE members ADD COLUMN IF NOT EXISTS note_nudges BOOLEAN NOT NULL DEFAULT true`,
    );

    // Existing plain-text sermon notes become notes, one paragraph per line.
    await queryRunner.query(`
      INSERT INTO notes (member_id, kind, title, content, plain_text, sermon_id, created_at, updated_at)
      SELECT sn.member_id, 'sermon', left(s.title, 200),
             jsonb_build_object('type', 'doc', 'content', COALESCE((
               SELECT jsonb_agg(
                        CASE WHEN line = '' THEN jsonb_build_object('type', 'paragraph')
                             ELSE jsonb_build_object('type', 'paragraph', 'content',
                                    jsonb_build_array(jsonb_build_object('type', 'text', 'text', line)))
                        END ORDER BY ord)
               FROM regexp_split_to_table(sn.note, E'\\r?\\n') WITH ORDINALITY AS t(line, ord)
             ), '[]'::jsonb)),
             replace(sn.note, E'\\r\\n', E'\\n'), sn.sermon_id, sn.created_at, sn.updated_at
      FROM sermon_notes sn
      JOIN sermons s ON s.id = sn.sermon_id
      WHERE NOT EXISTS (
        SELECT 1 FROM notes n WHERE n.member_id = sn.member_id AND n.sermon_id = sn.sermon_id
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE members DROP COLUMN IF EXISTS note_nudges`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS scripture_link_taps`);
    await queryRunner.query(`DROP TABLE IF EXISTS notes`);
  }
}
