import { MigrationInterface, QueryRunner } from 'typeorm';

// Control-plane — `public`, never a `search_path` target.
// PlatformAdminRole.permissions is a plain text[] snapshotted at row-creation
// time (DefaultPlatformAdminSeed only creates the SuperAdmin row once, never
// re-syncs it against the enum on subsequent boots) — adding
// BROADCAST_WRITE to PlatformAdminPermission does nothing for an
// already-seeded SuperAdmin role without this. Idempotent: only appends if
// missing, safe to run against a role seeded before or after this migration
// existed.
export class GrantSuperAdminBroadcastPermission1792371600000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE platform_admin_roles
       SET permissions = array_append(permissions, 'broadcast:write')
       WHERE name = 'SuperAdmin'
         AND NOT ('broadcast:write' = ANY(permissions))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE platform_admin_roles
       SET permissions = array_remove(permissions, 'broadcast:write')
       WHERE name = 'SuperAdmin'`,
    );
  }
}
