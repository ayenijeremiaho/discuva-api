import { MigrationInterface, QueryRunner } from 'typeorm';

// Tagline, address, and support email were displayed in both frontends via
// hardcoded build-time env vars from day one — never actually tenant data,
// just never given anywhere to live. Nullable: existing tenants have none
// of these set, and provisioning still doesn't collect them yet (§4.8).
export class AddTenantProfileFields1790726400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS tagline VARCHAR,
        ADD COLUMN IF NOT EXISTS address VARCHAR,
        ADD COLUMN IF NOT EXISTS support_email VARCHAR
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants
        DROP COLUMN IF EXISTS tagline,
        DROP COLUMN IF EXISTS address,
        DROP COLUMN IF EXISTS support_email
    `);
  }
}
