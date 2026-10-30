import { MigrationInterface, QueryRunner } from 'typeorm';

// Remembered devices from before this moment stop working ("Forget remembered devices").
export class AddAdminTwoFactorDevicesValidFrom1804147200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE admins ADD COLUMN IF NOT EXISTS two_factor_devices_valid_from timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE admins DROP COLUMN IF EXISTS two_factor_devices_valid_from`,
    );
  }
}
