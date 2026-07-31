import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFireAtToEventReminder1782777600000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE event_reminders
            ADD COLUMN IF NOT EXISTS fire_at TIMESTAMPTZ
        `);

    await queryRunner.query(`
            UPDATE event_reminders r
            SET fire_at = s.start_time - (
                CASE r.interval_preset
                    WHEN '15m' THEN 15
                    WHEN '30m' THEN 30
                    WHEN '1h'  THEN 60
                    WHEN '3h'  THEN 180
                    WHEN '24h' THEN 1440
                    WHEN '48h' THEN 2880
                    ELSE 15
                END * INTERVAL '1 minute'
            )
            FROM service_slots s
            WHERE r.service_slot_id = s.id
        `);

    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS idx_event_reminders_dispatch
            ON event_reminders (fire_at)
            WHERE enabled = true AND last_sent_at IS NULL
        `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_event_reminders_dispatch`,
    );
    await queryRunner.query(
      `ALTER TABLE event_reminders DROP COLUMN IF EXISTS fire_at`,
    );
  }
}
