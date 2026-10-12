import { MigrationInterface, QueryRunner } from 'typeorm';

// Scoreboard reads in their exact sort order, so each tab is an index range scan rather than a sort.
export class AddBibleGameBoardIndexes1801814400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Daily & weekly (and Levels' tie-break): this month's rows for one tab, by points.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_bible_game_board_monthly_board"`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_game_board_monthly_board" ON bible_game_board_monthly (month, board, points DESC)`,
    );
    // Levels, this month: levels passed, then points.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_game_board_monthly_levels" ON bible_game_board_monthly (month, levels_passed DESC, points DESC) WHERE board = 'levels'`,
    );
    // All-time tabs; the predicates match the scoreboard queries' WHERE clauses.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_game_progress_points_total" ON bible_game_progress (points_total DESC) WHERE points_total > 0`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_game_progress_points_daily" ON bible_game_progress (points_daily DESC) WHERE points_daily > 0`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_game_progress_levels" ON bible_game_progress (highest_passed DESC, points_levels DESC) WHERE (points_levels > 0 OR highest_passed > 0)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_bible_game_progress_levels"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_bible_game_progress_points_daily"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_bible_game_progress_points_total"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_bible_game_board_monthly_levels"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_bible_game_board_monthly_board"`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_game_board_monthly_board" ON bible_game_board_monthly (month, board)`,
    );
  }
}
