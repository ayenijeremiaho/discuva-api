import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCalendarEventOptions1801123200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE church_calendars ADD COLUMN IF NOT EXISTS include_events BOOLEAN NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE church_calendars ADD COLUMN IF NOT EXISTS repeat_display CHARACTER VARYING NOT NULL DEFAULT 'SUMMARY'`,
    );
    await queryRunner.query(
      `ALTER TABLE church_calendars ADD COLUMN IF NOT EXISTS hidden_event_keys JSONB NOT NULL DEFAULT '[]'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE church_calendars DROP COLUMN IF EXISTS hidden_event_keys`,
    );
    await queryRunner.query(
      `ALTER TABLE church_calendars DROP COLUMN IF EXISTS repeat_display`,
    );
    await queryRunner.query(
      `ALTER TABLE church_calendars DROP COLUMN IF EXISTS include_events`,
    );
  }
}
