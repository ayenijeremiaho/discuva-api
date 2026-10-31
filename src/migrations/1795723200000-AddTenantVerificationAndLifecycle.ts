import { MigrationInterface, QueryRunner } from 'typeorm';

// Accounts that are already live count as verified, so nothing changes for them.
export class AddTenantVerificationAndLifecycle1795723200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tenants
         ADD COLUMN IF NOT EXISTS verification_status character varying NOT NULL DEFAULT 'NONE',
         ADD COLUMN IF NOT EXISTS verified_at timestamptz,
         ADD COLUMN IF NOT EXISTS last_active_at timestamptz NOT NULL DEFAULT now(),
         ADD COLUMN IF NOT EXISTS inactivity_warned_at timestamptz,
         ADD COLUMN IF NOT EXISTS archived_at timestamptz`,
    );
    await queryRunner.query(
      `UPDATE tenants SET verification_status = 'VERIFIED', verified_at = now()
       WHERE onboarding_status = 'ACTIVE' AND verified_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tenants_unverified_last_active"
         ON tenants (last_active_at)
         WHERE verified_at IS NULL AND onboarding_status = 'ACTIVE'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tenants_verification_pending"
         ON tenants (created_at)
         WHERE verification_status = 'PENDING'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tenants_verification_pending"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tenants_unverified_last_active"`,
    );
    await queryRunner.query(
      `ALTER TABLE tenants
         DROP COLUMN IF EXISTS archived_at,
         DROP COLUMN IF EXISTS inactivity_warned_at,
         DROP COLUMN IF EXISTS last_active_at,
         DROP COLUMN IF EXISTS verified_at,
         DROP COLUMN IF EXISTS verification_status`,
    );
  }
}
