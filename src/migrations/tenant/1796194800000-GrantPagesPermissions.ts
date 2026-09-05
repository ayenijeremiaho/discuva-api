import { MigrationInterface, QueryRunner } from 'typeorm';

// Same class of fix as GrantFormsPermissions / GrantYoutubeIntegrationPermissions
// / GrantCommunicationProviderPermissions — new AdminPermission enum values
// are only auto-granted to a SuperAdmin role at the moment it's *created*
// (Object.values(AdminPermission), a one-time snapshot), so every tenant
// provisioned before the Pages module existed needs pages:read/pages:write
// backfilled explicitly. CreatePagesTable (the migration before this one)
// added the table but not this grant, which is why the "Pages" sidebar
// entry (gated by pages:read) never appeared for any existing tenant.
export class GrantPagesPermissions1796194800000 implements MigrationInterface {
  private readonly permissions = ['pages:read', 'pages:write'];

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
