import { MigrationInterface, QueryRunner } from 'typeorm';

const TABLES = ['events', 'event_series', 'event_templates'];

export class AddEventAudience1800950400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      await queryRunner.query(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS audience CHARACTER VARYING NOT NULL DEFAULT 'EVERYONE'`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS audience_group_id UUID`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} ADD CONSTRAINT "FK_${table}_audience_group" FOREIGN KEY (audience_group_id) REFERENCES groups(id) ON DELETE SET NULL`,
      );
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS "IDX_${table}_audience_group" ON ${table} (audience_group_id) WHERE audience_group_id IS NOT NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [...TABLES].reverse()) {
      await queryRunner.query(
        `DROP INDEX IF EXISTS "IDX_${table}_audience_group"`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS "FK_${table}_audience_group"`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} DROP COLUMN IF EXISTS audience_group_id`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} DROP COLUMN IF EXISTS audience`,
      );
    }
  }
}
