import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMemberChurchThemePreference1800169200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS use_church_theme BOOLEAN NOT NULL DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE members
        DROP COLUMN IF EXISTS use_church_theme
    `);
  }
}
