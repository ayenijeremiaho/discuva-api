import { MigrationInterface, QueryRunner } from 'typeorm';

// Remembered devices from before this moment stop working ("Forget remembered devices").
export class AddPlatformAdminTwoFactorDevicesValidFrom1795464000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS two_factor_devices_valid_from timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE platform_admins DROP COLUMN IF EXISTS two_factor_devices_valid_from`,
    );
  }
}
