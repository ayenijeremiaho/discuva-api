import { MigrationInterface, QueryRunner } from 'typeorm';

// Control-plane change — both tables live in `public`, never a `search_path`
// target. Platform admins had no permission system at all before this: just
// a binary isActive flag giving full access to every /platform/* route or
// none. Mirrors admin_roles/admins' own shape exactly, for the separate
// platform-admin identity system (PlatformAdminGuard, not AdminGuard).
//
// platform_admin_role_id is added nullable, backfilled to a seeded
// SuperAdmin role (covers any platform_admins row that predates this
// migration — e.g. one created by hand before this system existed), then
// tightened to NOT NULL — the standard safe-migration shape for adding a
// required column to a table that may already have rows.
export class AddPlatformAdminRoles1791504000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS platform_admin_roles (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        VARCHAR NOT NULL UNIQUE,
        description VARCHAR,
        permissions TEXT[] NOT NULL DEFAULT '{}',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      INSERT INTO platform_admin_roles (name, description, permissions) VALUES (
        'SuperAdmin',
        'Full access to all platform admin features.',
        ARRAY[
          'tenants:read', 'tenants:write', 'tenants:impersonate',
          'plans:read', 'plans:write',
          'communication_providers:read', 'communication_providers:write',
          'billing:read', 'billing:write',
          'analytics:read',
          'platform_admins:read', 'platform_admins:write'
        ]
      )
      ON CONFLICT (name) DO NOTHING
    `);

    await queryRunner.query(`
      ALTER TABLE platform_admins
      ADD COLUMN IF NOT EXISTS platform_admin_role_id UUID REFERENCES platform_admin_roles(id)
    `);

    await queryRunner.query(`
      UPDATE platform_admins
      SET platform_admin_role_id = (SELECT id FROM platform_admin_roles WHERE name = 'SuperAdmin')
      WHERE platform_admin_role_id IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE platform_admins
      ALTER COLUMN platform_admin_role_id SET NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE platform_admins DROP COLUMN IF EXISTS platform_admin_role_id
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS platform_admin_roles`);
  }
}
