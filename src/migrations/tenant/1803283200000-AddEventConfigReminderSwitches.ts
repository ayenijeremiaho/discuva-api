import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEventConfigReminderSwitches1803283200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE event_config ADD COLUMN IF NOT EXISTS send_service_reminders BOOLEAN NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE event_config ADD COLUMN IF NOT EXISTS send_checkin_reminders BOOLEAN NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE event_config DROP COLUMN IF EXISTS send_checkin_reminders`,
    );
    await queryRunner.query(
      `ALTER TABLE event_config DROP COLUMN IF EXISTS send_service_reminders`,
    );
  }
}
