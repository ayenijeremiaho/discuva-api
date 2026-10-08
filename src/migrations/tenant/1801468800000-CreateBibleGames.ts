import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBibleGames1801468800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bible_game_progress (
          member_id        UUID        NOT NULL,
          highest_passed   INT         NOT NULL DEFAULT 0,
          best             JSONB       NOT NULL DEFAULT '{}',
          daily_streak     INT         NOT NULL DEFAULT 0,
          last_daily_date  DATE,
          perfect_rounds   INT         NOT NULL DEFAULT 0,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT "PK_bible_game_progress" PRIMARY KEY (member_id),
          CONSTRAINT "FK_bible_game_progress_member" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bible_game_rounds (
          id             UUID              NOT NULL DEFAULT gen_random_uuid(),
          member_id      UUID              NOT NULL,
          mode           CHARACTER VARYING NOT NULL,
          level          INT,
          period_key     CHARACTER VARYING,
          time_limit     INT               NOT NULL,
          questions      JSONB             NOT NULL,
          answers        JSONB             NOT NULL DEFAULT '[]',
          current_index  INT               NOT NULL DEFAULT 0,
          asked_at       TIMESTAMPTZ,
          correct        INT               NOT NULL DEFAULT 0,
          points         INT               NOT NULL DEFAULT 0,
          awarded        INT               NOT NULL DEFAULT 0,
          status         CHARACTER VARYING NOT NULL DEFAULT 'active',
          finished_at    TIMESTAMPTZ,
          created_at     TIMESTAMPTZ       NOT NULL DEFAULT now(),
          updated_at     TIMESTAMPTZ       NOT NULL DEFAULT now(),
          CONSTRAINT "PK_bible_game_rounds" PRIMARY KEY (id),
          CONSTRAINT "FK_bible_game_rounds_member" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_game_rounds_member_created" ON bible_game_rounds (member_id, created_at)`,
    );
    // One Daily Challenge per day and one weekly round per week, even if abandoned part-way.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_bible_game_rounds_period" ON bible_game_rounds (member_id, mode, period_key) WHERE period_key IS NOT NULL`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bible_game_points (
          id          UUID              NOT NULL DEFAULT gen_random_uuid(),
          member_id   UUID              NOT NULL,
          mode        CHARACTER VARYING NOT NULL,
          points      INT               NOT NULL,
          round_id    UUID,
          created_at  TIMESTAMPTZ       NOT NULL DEFAULT now(),
          updated_at  TIMESTAMPTZ       NOT NULL DEFAULT now(),
          CONSTRAINT "PK_bible_game_points" PRIMARY KEY (id),
          CONSTRAINT "FK_bible_game_points_member" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
          CONSTRAINT "FK_bible_game_points_round" FOREIGN KEY (round_id) REFERENCES bible_game_rounds(id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_game_points_created" ON bible_game_points (created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_game_points_member" ON bible_game_points (member_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS bible_game_points`);
    await queryRunner.query(`DROP TABLE IF EXISTS bible_game_rounds`);
    await queryRunner.query(`DROP TABLE IF EXISTS bible_game_progress`);
  }
}
