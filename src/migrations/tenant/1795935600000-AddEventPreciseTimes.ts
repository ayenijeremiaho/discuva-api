import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEventPreciseTimes1795935600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE events
        ADD start_time TIMESTAMPTZ,
        ADD end_time   TIMESTAMPTZ
    `);

    await queryRunner.query(`
      UPDATE events e
      SET start_time = sub.min_start,
          end_time   = sub.max_end
      FROM (
          SELECT event_id, MIN(start_time) AS min_start, MAX(end_time) AS max_end
          FROM service_slots
          GROUP BY event_id
      ) sub
      WHERE e.id = sub.event_id
    `);

    // Events with no slots (shouldn't exist, but guard against a NOT NULL failure)
    await queryRunner.query(`
      UPDATE events
      SET start_time = event_date,
          end_time   = end_date + INTERVAL '1 day' - INTERVAL '1 second'
      WHERE start_time IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE events
        ALTER COLUMN start_time SET NOT NULL,
        ALTER COLUMN end_time SET NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_events_end_time" ON events (end_time)
    `);

    // findEventsReadyForAbsenceMarking filters on `attendance_marked = false
    // AND end_time < now` every 5 minutes. Without this, `end_time < now`
    // alone matches nearly every event a tenant has ever held (all history
    // is "in the past"), so the plain end_time index above degrades over
    // years to scanning most of the table before the attendance_marked
    // residual filter narrows it down. A partial index scoped to unmarked
    // events stays tiny forever, regardless of how much history accumulates
    // — same pattern as uq_service_session_access_grants_session_name_active's
    // `WHERE revoked_at IS NULL` elsewhere in this schema.
    await queryRunner.query(`
      CREATE INDEX "IDX_events_end_time_unmarked" ON events (end_time)
        WHERE attendance_marked = false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_events_end_time_unmarked"`);
    await queryRunner.query(`DROP INDEX "IDX_events_end_time"`);
    await queryRunner.query(`
      ALTER TABLE events
        DROP COLUMN start_time,
        DROP COLUMN end_time
    `);
  }
}
