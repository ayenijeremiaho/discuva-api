import { MigrationInterface, QueryRunner } from 'typeorm';

// Event search also matches dates ("11", "11 Oct"): WHERE EXTRACT(DAY ...) [AND EXTRACT(MONTH ...)] on event_date.
// Exact dates and years use IDX_events_event_date.
export class AddEventDateSearchIndex1802419200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_events_event_date_day_month" ON events ((EXTRACT(DAY FROM event_date)), (EXTRACT(MONTH FROM event_date)))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_events_event_date_day_month"`,
    );
  }
}
