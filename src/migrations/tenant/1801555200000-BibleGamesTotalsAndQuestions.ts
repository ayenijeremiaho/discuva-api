import { MigrationInterface, QueryRunner } from 'typeorm';

export class BibleGamesTotalsAndQuestions1801555200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Running totals, so scoreboards read one row per player instead of summing every round ever played.
    await queryRunner.query(
      `ALTER TABLE bible_game_progress ADD COLUMN IF NOT EXISTS points_total INT NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`
      UPDATE bible_game_progress g SET points_total = t.total
      FROM (SELECT member_id, SUM(points)::int AS total FROM bible_game_points GROUP BY member_id) t
      WHERE t.member_id = g.member_id
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bible_game_monthly (
          member_id   UUID        NOT NULL,
          month       DATE        NOT NULL,
          points      INT         NOT NULL DEFAULT 0,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT "PK_bible_game_monthly" PRIMARY KEY (member_id, month),
          CONSTRAINT "FK_bible_game_monthly_member" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_game_monthly_board" ON bible_game_monthly (month, points DESC)`,
    );
    // Months are counted in the church's own timezone, as the app does.
    await queryRunner.query(`
      INSERT INTO bible_game_monthly (member_id, month, points)
      SELECT p.member_id,
             date_trunc('month', p.created_at AT TIME ZONE COALESCE(
               (SELECT t.timezone FROM public.tenants t WHERE t.schema_name = current_schema()), 'UTC'))::date,
             SUM(p.points)::int
      FROM bible_game_points p
      GROUP BY 1, 2
      ON CONFLICT (member_id, month) DO UPDATE SET points = EXCLUDED.points
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bible_game_custom_questions (
          id                   UUID              NOT NULL DEFAULT gen_random_uuid(),
          prompt               TEXT              NOT NULL,
          options              JSONB             NOT NULL,
          answer               INT               NOT NULL,
          explain              TEXT,
          level_min            INT               NOT NULL DEFAULT 1,
          level_max            INT               NOT NULL DEFAULT 20,
          active               BOOLEAN           NOT NULL DEFAULT true,
          created_by_admin_id  UUID,
          created_at           TIMESTAMPTZ       NOT NULL DEFAULT now(),
          updated_at           TIMESTAMPTZ       NOT NULL DEFAULT now(),
          CONSTRAINT "PK_bible_game_custom_questions" PRIMARY KEY (id),
          CONSTRAINT "FK_bible_game_custom_questions_admin" FOREIGN KEY (created_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bible_game_hidden (
          key                 CHARACTER VARYING NOT NULL,
          label               CHARACTER VARYING,
          hidden_by_admin_id  UUID,
          created_at          TIMESTAMPTZ       NOT NULL DEFAULT now(),
          updated_at          TIMESTAMPTZ       NOT NULL DEFAULT now(),
          CONSTRAINT "PK_bible_game_hidden" PRIMARY KEY (key),
          CONSTRAINT "FK_bible_game_hidden_admin" FOREIGN KEY (hidden_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
      )
    `);

    // "This week's verses" reads the last 7 days of notes.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_notes_created_at" ON notes (created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_game_rounds_active" ON bible_game_rounds (member_id) WHERE status = 'active'`,
    );
    // Admin stats: who played today's Daily Challenge.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_game_rounds_period" ON bible_game_rounds (mode, period_key) WHERE period_key IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_bible_game_rounds_period"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_bible_game_rounds_active"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notes_created_at"`);
    await queryRunner.query(`DROP TABLE IF EXISTS bible_game_hidden`);
    await queryRunner.query(`DROP TABLE IF EXISTS bible_game_custom_questions`);
    await queryRunner.query(`DROP TABLE IF EXISTS bible_game_monthly`);
    await queryRunner.query(
      `ALTER TABLE bible_game_progress DROP COLUMN IF EXISTS points_total`,
    );
  }
}
