import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCheckinCloseMode1800864000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Existing configs keep their set-time-after-start behaviour.
    await queryRunner.query(
      `ALTER TABLE event_config ADD COLUMN IF NOT EXISTS checkin_close_mode CHARACTER VARYING NOT NULL DEFAULT 'AFTER_START'`,
    );
    await queryRunner.query(
      `ALTER TABLE service_slots ADD COLUMN IF NOT EXISTS checkin_close_mode_override CHARACTER VARYING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE service_slots DROP COLUMN IF EXISTS checkin_close_mode_override`,
    );
    await queryRunner.query(
      `ALTER TABLE event_config DROP COLUMN IF EXISTS checkin_close_mode`,
    );
  }
}
