import { MigrationInterface, QueryRunner } from 'typeorm';

// Both the tenant-side admin role (admin_roles, one per church) and the
// platform-side admin role (platform_admin_roles, all tenants) were
// independently seeded as literally 'SuperAdmin' — indistinguishable by
// name alone across two very different scopes. Renaming the platform side
// only: it's a single control-plane table with few rows, versus the
// tenant-side name which every existing church's primary admin already
// sees and which would need a migration across every tenant schema.
export class RenamePlatformSuperAdminRole1793044800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE platform_admin_roles SET name = 'Platform Super Admin' WHERE name = 'SuperAdmin'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE platform_admin_roles SET name = 'SuperAdmin' WHERE name = 'Platform Super Admin'`,
    );
  }
}
