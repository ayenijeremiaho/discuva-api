import { MigrationInterface, QueryRunner } from 'typeorm';

// Control-plane change — both changes live in `public`, never a
// `search_path` target. Mirrors members.changed_password /
// password_reset_otps (§Auth) for the separate platform-admin identity
// system, so onboarding a new platform admin can follow the same
// generate-random-password-and-email-a-set-password-link flow just built
// for tenant provisioning, instead of an existing admin typing a password
// into a form on the new admin's behalf.
//
// changed_password defaults to true — every pre-existing platform_admins
// row was created either by the bootstrap seed or by a human typing in a
// real chosen password, so there's nothing to force a change on. Only the
// new onboarding path explicitly sets it false.
export class AddPlatformAdminPasswordReset1791590400000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE platform_admins
      ADD COLUMN IF NOT EXISTS changed_password BOOLEAN NOT NULL DEFAULT true
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS platform_admin_password_reset_otps (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        platform_admin_id  UUID NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
        otp_hash           VARCHAR NOT NULL,
        expires_at         TIMESTAMPTZ NOT NULL,
        used_at            TIMESTAMPTZ,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_platform_admin_password_reset_otps_admin_id
      ON platform_admin_password_reset_otps(platform_admin_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS platform_admin_password_reset_otps`,
    );
    await queryRunner.query(`
      ALTER TABLE platform_admins DROP COLUMN IF EXISTS changed_password
    `);
  }
}
