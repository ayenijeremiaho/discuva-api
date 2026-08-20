import { MigrationInterface, QueryRunner } from 'typeorm';

// TenantSchemaGenesis (and, before it, the legacy InitialSchema/Baseline
// seed lists) insert a 'Super Admin' (with a space) admin_roles row on
// every tenant provision — a leftover from before AdminRoleService's
// 'SuperAdmin' (no space) naming convention existed. The real admin
// created during provisioning is always assigned to 'SuperAdmin', never
// this one, and none of the later permission-grant migrations
// (GrantCommunicationProviderPermissions, GrantFormsPermissions, etc.)
// target it either, so it's dead weight sitting in every tenant's schema.
// tenant-provisioning.service.ts now deletes it for newly-provisioned
// tenants going forward — this migration cleans up the rows already
// created in existing tenant schemas. Guarded by NOT EXISTS so a tenant
// where an admin is somehow actually assigned to it (none found in
// practice, but admins.admin_role_id is ON DELETE RESTRICT) is left
// untouched rather than failing the whole migration run.
export class RemoveOrphanedSuperAdminSpaceRole1792566000000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM admin_roles
      WHERE name = 'Super Admin'
      AND NOT EXISTS (
        SELECT 1 FROM admins WHERE admins.admin_role_id = admin_roles.id
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO admin_roles (name, description, permissions)
      SELECT 'Super Admin', 'Full access to all modules.', '{}'
      WHERE NOT EXISTS (SELECT 1 FROM admin_roles WHERE name = 'Super Admin')
    `);
  }
}
