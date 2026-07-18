import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePastors1787961600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS pastors (
                id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                member_id  UUID NOT NULL UNIQUE REFERENCES members(id) ON DELETE CASCADE,
                type       VARCHAR NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS pastors`);
  }
}
