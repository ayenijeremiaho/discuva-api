import { MigrationInterface, QueryRunner } from 'typeorm';

export class RefactorAttendanceAndEvents1781913600000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    // ── events: add end_date and attendance_marked ────────────────────────────
    await queryRunner.query(`
            ALTER TABLE events
                ADD COLUMN IF NOT EXISTS end_date DATE,
                ADD COLUMN IF NOT EXISTS attendance_marked BOOLEAN NOT NULL DEFAULT false
        `);
    // Backfill: single-day events end on their own event_date
    await queryRunner.query(
      `UPDATE events SET end_date = event_date WHERE end_date IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE events ALTER COLUMN end_date SET NOT NULL`,
    );

    // ── service_slots: drop marked_absent ────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE service_slots DROP COLUMN IF EXISTS marked_absent`,
    );

    // ── attendances: add event_id, make service_slot_id nullable, swap unique ─
    await queryRunner.query(`
            ALTER TABLE attendances
                ADD COLUMN IF NOT EXISTS event_id UUID
        `);
    // Backfill event_id from the existing service_slot relation
    await queryRunner.query(`
            UPDATE attendances a
            SET event_id = s.event_id
            FROM service_slots s
            WHERE a.service_slot_id = s.id
        `);
    await queryRunner.query(
      `ALTER TABLE attendances ALTER COLUMN event_id SET NOT NULL`,
    );
    await queryRunner.query(`
            ALTER TABLE attendances
                ADD CONSTRAINT fk_attendances_event
                FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        `);

    // Make service_slot_id nullable (absence and online records have no slot)
    await queryRunner.query(
      `ALTER TABLE attendances ALTER COLUMN service_slot_id DROP NOT NULL`,
    );
    // Update the FK to SET NULL on slot delete so absence records survive slot removal
    await queryRunner.query(`
            ALTER TABLE attendances DROP CONSTRAINT IF EXISTS "FK_attendances_service_slot_id"
        `);
    await queryRunner.query(`
            ALTER TABLE attendances
                ADD CONSTRAINT fk_attendances_service_slot
                FOREIGN KEY (service_slot_id) REFERENCES service_slots(id) ON DELETE SET NULL
        `);

    // Swap unique constraint: was (member_id, service_slot_id), now (member_id, event_id)
    await queryRunner.query(`
            ALTER TABLE attendances
                DROP CONSTRAINT IF EXISTS "UQ_attendances_member_serviceSlot"
        `);
    await queryRunner.query(`
            ALTER TABLE attendances
                DROP CONSTRAINT IF EXISTS "UQ_7f02c46ac5b4a4f41abe1ef1f25"
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS UQ_attendances_member_event
                ON attendances (member_id, event_id)
        `);

    // Index on event_id for absence marking queries
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS IDX_attendances_event_id ON attendances (event_id)
        `);

    // ── members: rename year_joined_church → date_joined_church ──────────────
    await queryRunner.query(`
            ALTER TABLE members
                RENAME COLUMN year_joined_church TO date_joined_church
        `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN date_joined_church TO year_joined_church`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS IDX_attendances_event_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS UQ_attendances_member_event`);

    await queryRunner.query(`
            ALTER TABLE attendances
                ADD CONSTRAINT "UQ_attendances_member_serviceSlot"
                UNIQUE (member_id, service_slot_id)
        `);
    await queryRunner.query(
      `ALTER TABLE attendances DROP CONSTRAINT IF EXISTS fk_attendances_service_slot`,
    );
    await queryRunner.query(
      `ALTER TABLE attendances DROP CONSTRAINT IF EXISTS fk_attendances_event`,
    );
    await queryRunner.query(
      `ALTER TABLE attendances DROP COLUMN IF EXISTS event_id`,
    );
    await queryRunner.query(
      `ALTER TABLE attendances ALTER COLUMN service_slot_id SET NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE service_slots ADD COLUMN IF NOT EXISTS marked_absent BOOLEAN NOT NULL DEFAULT false`,
    );

    await queryRunner.query(
      `ALTER TABLE events DROP COLUMN IF EXISTS attendance_marked`,
    );
    await queryRunner.query(
      `ALTER TABLE events DROP COLUMN IF EXISTS end_date`,
    );
  }
}
