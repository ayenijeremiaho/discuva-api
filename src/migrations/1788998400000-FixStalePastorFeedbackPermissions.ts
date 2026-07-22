import { MigrationInterface, QueryRunner } from 'typeorm';

// The Department Feedback -> Pastor Feedback rename (see RenamePastorFeedbackTable)
// only renamed the AdminPermission enum values in code — any admin_roles row
// granted the OLD 'department_feedback:read'/'write' strings before that rename
// still has those exact strings in its permissions array, which no longer
// match anything AdminGuard checks for (a plain .includes() string match).
export class FixStalePastorFeedbackPermissions1788998400000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE admin_roles
      SET permissions = array_replace(
        array_replace(permissions, 'department_feedback:read', 'pastor_feedback:read'),
        'department_feedback:write', 'pastor_feedback:write'
      )
      WHERE 'department_feedback:read' = ANY(permissions)
         OR 'department_feedback:write' = ANY(permissions)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE admin_roles
      SET permissions = array_replace(
        array_replace(permissions, 'pastor_feedback:read', 'department_feedback:read'),
        'pastor_feedback:write', 'department_feedback:write'
      )
      WHERE 'pastor_feedback:read' = ANY(permissions)
         OR 'pastor_feedback:write' = ANY(permissions)
    `);
  }
}
