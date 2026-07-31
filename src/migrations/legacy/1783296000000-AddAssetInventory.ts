import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAssetInventory1783296000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE assets
                ADD COLUMN IF NOT EXISTS inventory_enabled BOOLEAN NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS total_units INTEGER,
                ADD COLUMN IF NOT EXISTS available_units INTEGER
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE assets
                DROP COLUMN IF EXISTS inventory_enabled,
                DROP COLUMN IF EXISTS total_units,
                DROP COLUMN IF EXISTS available_units
        `);
  }
}
