import { MigrationInterface, QueryRunner } from 'typeorm';

// Same class of fix as GrantFormsPermissions — new AdminPermission enum
// values are only auto-granted to a SuperAdmin role at the moment it's
// *created*, so every tenant provisioned before the Social Media module
// existed needs social_media:read/social_media:write backfilled explicitly.
export class GrantSocialMediaPermissions1791504000000
  implements MigrationInterface
{
  private readonly permissions = ['social_media:read', 'social_media:write'];

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
