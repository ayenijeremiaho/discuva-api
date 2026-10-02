import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPreviousTenantThemePreset1794772802000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS previous_theme_preset VARCHAR
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants
        DROP COLUMN IF EXISTS previous_theme_preset
    `);
  }
}
