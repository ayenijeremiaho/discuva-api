import { MigrationInterface, QueryRunner } from 'typeorm';

// The member app's Attendance tab pages through WHERE member_id = ? ORDER BY created_at DESC as the member scrolls.
export class AddAttendanceMemberHistoryIndex1802246400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_attendances_member_createdAt" ON attendances (member_id, created_at DESC)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_attendances_member_createdAt"`,
    );
  }
}
