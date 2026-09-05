import { MigrationInterface, QueryRunner } from 'typeorm';

// Same class of fix as GrantPagesPermissions / GrantFormsPermissions — new
// AdminPermission enum values are only auto-granted to a SuperAdmin role at
// the moment it's *created* (Object.values(AdminPermission), a one-time
// snapshot), so every tenant provisioned before Church Calendar existed
// needs church_calendar:read/write backfilled explicitly. Without this, the
// "Church Calendar" sidebar entry (gated by church_calendar:read) would
// never appear for any existing tenant, same bug already hit once for Pages.
export class GrantChurchCalendarPermissions1796367600000 implements MigrationInterface {
  private readonly permissions = [
    'church_calendar:read',
    'church_calendar:write',
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
