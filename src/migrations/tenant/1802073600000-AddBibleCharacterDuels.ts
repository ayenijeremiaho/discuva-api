import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBibleCharacterDuels1802073600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bible_character_duels (
          id                   UUID              NOT NULL DEFAULT gen_random_uuid(),
          challenger_id        UUID              NOT NULL,
          opponent_id          UUID              NOT NULL,
          difficulty           CHARACTER VARYING NOT NULL,
          status               CHARACTER VARYING NOT NULL DEFAULT 'invited',
          challenger_character CHARACTER VARYING NULL,
          opponent_character   CHARACTER VARYING NULL,
          challenger_state     JSONB             NOT NULL DEFAULT '{"asked":[],"hints":0,"wrong":[]}',
          opponent_state       JSONB             NOT NULL DEFAULT '{"asked":[],"hints":0,"wrong":[]}',
          turn                 CHARACTER VARYING NULL,
          turn_number          INT               NOT NULL DEFAULT 0,
          turn_deadline        TIMESTAMPTZ       NULL,
          final_turn           BOOLEAN           NOT NULL DEFAULT false,
          winner               CHARACTER VARYING NULL,
          reason               CHARACTER VARYING NULL,
          challenger_points    INT               NOT NULL DEFAULT 0,
          opponent_points      INT               NOT NULL DEFAULT 0,
          challenger_scored    BOOLEAN           NOT NULL DEFAULT false,
          opponent_scored      BOOLEAN           NOT NULL DEFAULT false,
          finished_at          TIMESTAMPTZ       NULL,
          created_at           TIMESTAMPTZ       NOT NULL DEFAULT now(),
          updated_at           TIMESTAMPTZ       NOT NULL DEFAULT now(),
          CONSTRAINT "PK_bible_character_duels" PRIMARY KEY (id),
          CONSTRAINT "FK_bible_character_duels_challenger" FOREIGN KEY (challenger_id) REFERENCES members(id) ON DELETE CASCADE,
          CONSTRAINT "FK_bible_character_duels_opponent" FOREIGN KEY (opponent_id) REFERENCES members(id) ON DELETE CASCADE,
          CONSTRAINT "CHK_bible_character_duels_players" CHECK (challenger_id <> opponent_id)
      )
    `);
    // Each player's duels, newest first (also covers the member FK cascades).
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_character_duels_challenger" ON bible_character_duels (challenger_id, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_character_duels_opponent" ON bible_character_duels (opponent_id, created_at DESC)`,
    );
    // At most one open duel between the same two people, whoever invited whom.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_bible_character_duels_open_pair" ON bible_character_duels (LEAST(challenger_id, opponent_id), GREATEST(challenger_id, opponent_id)) WHERE status IN ('invited', 'active')`,
    );
    // The hourly sweep for turns and invites that ran out of time.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_character_duels_deadline" ON bible_character_duels (turn_deadline) WHERE status IN ('invited', 'active')`,
    );
    // Today's scored wins, for the daily limit shared with Solo.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_character_duels_challenger_scored" ON bible_character_duels (challenger_id, finished_at) WHERE challenger_scored`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_character_duels_opponent_scored" ON bible_character_duels (opponent_id, finished_at) WHERE opponent_scored`,
    );
    // Admin stats: duels finished this month.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_character_duels_finished" ON bible_character_duels (finished_at) WHERE status = 'finished'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS bible_character_duels`);
  }
}
