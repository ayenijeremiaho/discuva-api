import { MigrationInterface, QueryRunner } from 'typeorm';

// New AdminPermission enum values (COMMUNICATION_PROVIDERS_READ/WRITE) are
// only auto-granted to a SuperAdmin role at the moment it's *created*
// (TenantProvisioningService.seedTenantAdmin sets
// permissions: Object.values(AdminPermission), a one-time snapshot) — every
// tenant provisioned before this permission existed has a SuperAdmin row
// whose permissions array simply doesn't contain it
// (feedback_permission_rename_needs_data_migration — same class of bug as
// a rename, just an addition instead). admin_roles is tenant-schema data
// (TenantSchemaGenesis), so this has to run per-tenant via
// `npm run migration:run:all-tenants`, not the main public-schema runner.
export class GrantCommunicationProviderPermissions1790812800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE admin_roles
      SET permissions = array_append(
        array_append(permissions, 'communication_providers:read'),
        'communication_providers:write'
      )
      WHERE name = 'SuperAdmin'
        AND NOT ('communication_providers:read' = ANY(permissions))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE admin_roles
      SET permissions = array_remove(
        array_remove(permissions, 'communication_providers:read'),
        'communication_providers:write'
      )
      WHERE name = 'SuperAdmin'
    `);
  }
}
