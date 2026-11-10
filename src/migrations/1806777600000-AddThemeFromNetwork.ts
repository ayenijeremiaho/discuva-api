import { MigrationInterface, QueryRunner } from 'typeorm';

// Branches follow their network's theme until their own admins pick one.
export class AddThemeFromNetwork1806777600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS theme_from_network boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE tenants SET theme_from_network = true WHERE network_root_id IS NOT NULL AND network_root_id <> id`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tenants DROP COLUMN IF EXISTS theme_from_network`,
    );
  }
}
