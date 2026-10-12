import { MigrationInterface, QueryRunner } from 'typeorm';

// The church's own timezone, as the app counts months.
const TZ = `COALESCE((SELECT t.timezone FROM public.tenants t WHERE t.schema_name = current_schema()), 'UTC')`;
const BOARD = `CASE WHEN p.mode IN ('level', 'mastery') THEN 'levels' ELSE 'daily' END`;

export class AddBibleGameBoards1801728000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Per-tab monthly totals (Levels, Daily & weekly); bible_game_monthly stays the All games total.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bible_game_board_monthly (
          member_id      UUID              NOT NULL,
          month          DATE              NOT NULL,
          board          CHARACTER VARYING NOT NULL,
          points         INT               NOT NULL DEFAULT 0,
          levels_passed  INT               NOT NULL DEFAULT 0,
          created_at     TIMESTAMPTZ       NOT NULL DEFAULT now(),
          updated_at     TIMESTAMPTZ       NOT NULL DEFAULT now(),
          CONSTRAINT "PK_bible_game_board_monthly" PRIMARY KEY (member_id, month, board),
          CONSTRAINT "FK_bible_game_board_monthly_member" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_game_board_monthly_board" ON bible_game_board_monthly (month, board)`,
    );
    await queryRunner.query(`
      ALTER TABLE bible_game_progress
        ADD COLUMN IF NOT EXISTS points_levels INT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS points_daily  INT NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      INSERT INTO bible_game_board_monthly (member_id, month, board, points)
      SELECT p.member_id, date_trunc('month', p.created_at AT TIME ZONE ${TZ})::date, ${BOARD}, SUM(p.points)::int
      FROM bible_game_points p
      GROUP BY 1, 2, 3
      ON CONFLICT (member_id, month, board) DO UPDATE SET points = EXCLUDED.points
    `);
    await queryRunner.query(`
      UPDATE bible_game_progress g SET
        points_levels = COALESCE(t.levels, 0),
        points_daily  = COALESCE(t.daily, 0)
      FROM (
        SELECT p.member_id,
               SUM(p.points) FILTER (WHERE ${BOARD} = 'levels')::int AS levels,
               SUM(p.points) FILTER (WHERE ${BOARD} = 'daily')::int AS daily
        FROM bible_game_points p GROUP BY 1
      ) t
      WHERE t.member_id = g.member_id
    `);
    // A level counts in the month it was first passed. Rounds are kept 60 days and Bible Games is newer than that,
    // so the first passing round of each level is still on record.
    await queryRunner.query(`
      INSERT INTO bible_game_board_monthly (member_id, month, board, levels_passed)
      SELECT f.member_id, date_trunc('month', f.first_pass AT TIME ZONE ${TZ})::date, 'levels', COUNT(*)::int
      FROM (
        SELECT r.member_id, r.level, MIN(r.finished_at) AS first_pass
        FROM bible_game_rounds r
        JOIN bible_game_progress g ON g.member_id = r.member_id AND r.level <= g.highest_passed
        WHERE r.mode = 'level' AND r.status = 'finished' AND r.correct >= 7
        GROUP BY 1, 2
      ) f
      GROUP BY 1, 2
      ON CONFLICT (member_id, month, board) DO UPDATE SET levels_passed = EXCLUDED.levels_passed
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE bible_game_progress
        DROP COLUMN IF EXISTS points_daily,
        DROP COLUMN IF EXISTS points_levels
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_bible_game_board_monthly_board"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS bible_game_board_monthly`);
  }
}
