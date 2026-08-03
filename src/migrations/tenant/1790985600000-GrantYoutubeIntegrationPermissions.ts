import { MigrationInterface, QueryRunner } from 'typeorm';

// Same class of fix as GrantCommunicationProviderPermissions — new
// AdminPermission enum values are only auto-granted to a SuperAdmin role
// at the moment it's *created* (Object.values(AdminPermission), a one-time
// snapshot), so every tenant provisioned before this permission existed
// needs it backfilled explicitly.
export class GrantYoutubeIntegrationPermissions1790985600000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE admin_roles
      SET permissions = array_append(
        array_append(permissions, 'youtube_integration:read'),
        'youtube_integration:write'
      )
      WHERE name = 'SuperAdmin'
        AND NOT ('youtube_integration:read' = ANY(permissions))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE admin_roles
      SET permissions = array_remove(
        array_remove(permissions, 'youtube_integration:read'),
        'youtube_integration:write'
      )
      WHERE name = 'SuperAdmin'
    `);
  }
}
