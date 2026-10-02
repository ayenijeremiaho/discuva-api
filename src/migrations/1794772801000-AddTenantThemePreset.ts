import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTenantThemePreset1794772801000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS theme_preset VARCHAR NOT NULL DEFAULT 'classic',
        ADD COLUMN IF NOT EXISTS previous_theme_preset VARCHAR
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants
        DROP COLUMN IF EXISTS previous_theme_preset,
        DROP COLUMN IF EXISTS theme_preset
    `);
  }
}
