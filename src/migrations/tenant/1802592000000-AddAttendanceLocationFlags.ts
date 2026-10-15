import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAttendanceLocationFlags1802592000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE attendances ADD COLUMN IF NOT EXISTS location_flags CHARACTER VARYING[] NOT NULL DEFAULT '{}'`,
    );
    // Attendance History "Flagged only": WHERE cardinality(location_flags) > 0 ORDER BY created_at DESC.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_attendances_flagged_created" ON attendances (created_at DESC) WHERE cardinality(location_flags) > 0`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_attendances_flagged_created"`,
    );
    await queryRunner.query(
      `ALTER TABLE attendances DROP COLUMN IF EXISTS location_flags`,
    );
  }
}
