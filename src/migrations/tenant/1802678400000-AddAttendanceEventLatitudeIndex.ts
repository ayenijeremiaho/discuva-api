import { MigrationInterface, QueryRunner } from 'typeorm';

// LocationFlagService's SHARED_SPOT lookup: WHERE event_id = ? AND (location->>'latitude')::float8 = ?.
// Without it each check-in re-reads every location in the event (quadratic over a large service).
export class AddAttendanceEventLatitudeIndex1802678400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_attendances_event_latitude" ON attendances (event_id, ((location->>'latitude')::float8)) WHERE location IS NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_attendances_event_latitude"`,
    );
  }
}
