import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGuessTheBibleCharacter1801987200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bible_character_rounds (
          id             UUID              NOT NULL DEFAULT gen_random_uuid(),
          member_id      UUID              NOT NULL,
          character_id   CHARACTER VARYING NOT NULL,
          difficulty     CHARACTER VARYING NOT NULL,
          status         CHARACTER VARYING NOT NULL DEFAULT 'active',
          asked          JSONB             NOT NULL DEFAULT '[]',
          hints          INT               NOT NULL DEFAULT 0,
          wrong_guesses  JSONB             NOT NULL DEFAULT '[]',
          points         INT               NOT NULL DEFAULT 0,
          scored         BOOLEAN           NOT NULL DEFAULT false,
          finished_at    TIMESTAMPTZ       NULL,
          created_at     TIMESTAMPTZ       NOT NULL DEFAULT now(),
          updated_at     TIMESTAMPTZ       NOT NULL DEFAULT now(),
          CONSTRAINT "PK_bible_character_rounds" PRIMARY KEY (id),
          CONSTRAINT "FK_bible_character_rounds_member" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
      )
    `);
    // One game in progress per member, found without scanning their history.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_bible_character_rounds_active" ON bible_character_rounds (member_id) WHERE status = 'active'`,
    );
    // A member's recent games: characters to avoid repeating, and today's scored games.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_character_rounds_member_created" ON bible_character_rounds (member_id, created_at DESC)`,
    );
    // Admin stats: this month's finished games per character.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_character_rounds_finished" ON bible_character_rounds (finished_at, character_id) WHERE finished_at IS NOT NULL`,
    );

    // The Characters scoreboard tab: points and characters found, monthly and all time.
    await queryRunner.query(
      `ALTER TABLE bible_game_board_monthly ADD COLUMN IF NOT EXISTS found INT NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`
      ALTER TABLE bible_game_progress
        ADD COLUMN IF NOT EXISTS points_characters INT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS characters_found  INT NOT NULL DEFAULT 0
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_game_progress_points_characters" ON bible_game_progress (points_characters DESC) WHERE points_characters > 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_bible_game_progress_points_characters"`,
    );
    await queryRunner.query(`
      ALTER TABLE bible_game_progress
        DROP COLUMN IF EXISTS characters_found,
        DROP COLUMN IF EXISTS points_characters
    `);
    await queryRunner.query(
      `ALTER TABLE bible_game_board_monthly DROP COLUMN IF EXISTS found`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS bible_character_rounds`);
  }
}
