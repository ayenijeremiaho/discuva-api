import { MigrationInterface, QueryRunner } from 'typeorm';

// Same class of fix as GrantYoutubeIntegrationPermissions /
// GrantCommunicationProviderPermissions / GrantChurchProfileBillingBranchPermissions
// — new AdminPermission enum values are only auto-granted to a SuperAdmin
// role at the moment it's *created* (Object.values(AdminPermission), a
// one-time snapshot), so every tenant provisioned before the Forms module
// existed needs forms:read/forms:write backfilled explicitly.
export class GrantFormsPermissions1791244800000 implements MigrationInterface {
  private readonly permissions = ['forms:read', 'forms:write'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const permission of this.permissions) {
      await queryRunner.query(
        `
        UPDATE admin_roles
        SET permissions = array_append(permissions, $1)
        WHERE name = 'SuperAdmin'
          AND NOT ($1 = ANY(permissions))
        `,
        [permission],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const permission of this.permissions) {
      await queryRunner.query(
        `
        UPDATE admin_roles
        SET permissions = array_remove(permissions, $1)
        WHERE name = 'SuperAdmin'
        `,
        [permission],
      );
    }
  }
}
