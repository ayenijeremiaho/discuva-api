import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOutreaches1800518400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS outreaches (
          id               UUID              NOT NULL DEFAULT gen_random_uuid(),
          title            CHARACTER VARYING,
          location         CHARACTER VARYING,
          outreach_date    DATE              NOT NULL,
          created_by       UUID,
          created_by_name  CHARACTER VARYING NOT NULL,
          created_at       TIMESTAMPTZ       NOT NULL DEFAULT now(),
          updated_at       TIMESTAMPTZ       NOT NULL DEFAULT now(),
          CONSTRAINT "PK_outreaches" PRIMARY KEY (id),
          CONSTRAINT "FK_outreaches_created_by" FOREIGN KEY (created_by) REFERENCES members(id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_outreaches_outreach_date" ON outreaches (outreach_date)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS outreach_team (
          outreach_id  UUID NOT NULL,
          member_id    UUID NOT NULL,
          CONSTRAINT "PK_outreach_team" PRIMARY KEY (outreach_id, member_id),
          CONSTRAINT "FK_outreach_team_outreach_id" FOREIGN KEY (outreach_id) REFERENCES outreaches(id) ON DELETE CASCADE,
          CONSTRAINT "FK_outreach_team_member_id" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_outreach_team_member_id" ON outreach_team (member_id)`,
    );

    await queryRunner.query(
      `ALTER TABLE converts ADD COLUMN IF NOT EXISTS outreach_id UUID`,
    );
    await queryRunner.query(`
      ALTER TABLE converts
        ADD CONSTRAINT "FK_converts_outreach_id" FOREIGN KEY (outreach_id) REFERENCES outreaches(id) ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_converts_outreach_id" ON converts (outreach_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_converts_phone" ON converts (phone)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_converts_phone"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_converts_outreach_id"`);
    await queryRunner.query(
      `ALTER TABLE converts DROP CONSTRAINT IF EXISTS "FK_converts_outreach_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE converts DROP COLUMN IF EXISTS outreach_id`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS outreach_team`);
    await queryRunner.query(`DROP TABLE IF EXISTS outreaches`);
  }
}
