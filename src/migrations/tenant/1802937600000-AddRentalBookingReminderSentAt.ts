import { MigrationInterface, QueryRunner } from 'typeorm';

// The day-before reminder is sent once; the partial index serves the scheduler's "confirmed, not yet reminded" query.
export class AddRentalBookingReminderSentAt1802937600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE rental_bookings ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_rental_bookings_reminder_due" ON rental_bookings (start_date_time) WHERE status = 'CONFIRMED' AND reminder_sent_at IS NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_rental_bookings_reminder_due"`,
    );
    await queryRunner.query(
      `ALTER TABLE rental_bookings DROP COLUMN IF EXISTS reminder_sent_at`,
    );
  }
}
