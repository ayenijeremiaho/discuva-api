import { MigrationInterface, QueryRunner } from 'typeorm';

// Optional 2FA for church admins; every column stays null until an admin opts in.
export class AddAdminTwoFactor1804060800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE admins
         ADD COLUMN IF NOT EXISTS two_factor_secret text,
         ADD COLUMN IF NOT EXISTS two_factor_enabled_at timestamptz,
         ADD COLUMN IF NOT EXISTS two_factor_last_step integer,
         ADD COLUMN IF NOT EXISTS two_factor_backup_codes text[]`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE admins
         DROP COLUMN IF EXISTS two_factor_secret,
         DROP COLUMN IF EXISTS two_factor_enabled_at,
         DROP COLUMN IF EXISTS two_factor_last_step,
         DROP COLUMN IF EXISTS two_factor_backup_codes`,
    );
  }
}
