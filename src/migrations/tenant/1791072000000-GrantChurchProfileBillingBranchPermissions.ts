import { MigrationInterface, QueryRunner } from 'typeorm';

// Same class of fix as GrantYoutubeIntegrationPermissions /
// GrantCommunicationProviderPermissions — new AdminPermission enum values
// are only auto-granted to a SuperAdmin role at the moment it's *created*
// (Object.values(AdminPermission), a one-time snapshot), so every tenant
// provisioned before these permissions existed needs them backfilled
// explicitly. All five land in one migration since they were all added in
// the same pass (church profile self-service, billing/plan checkout, branch
// hierarchy).
export class GrantChurchProfileBillingBranchPermissions1791072000000
  implements MigrationInterface
{
  private readonly permissions = [
    'church_profile:write',
    'billing:read',
    'billing:write',
    'branch:read',
    'branch:write',
  ];

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
