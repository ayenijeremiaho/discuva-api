import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOnlineConfirmClosesAt1801036800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Fixed when the online-confirm emails go out, so a later settings change doesn't move a window already announced.
    await queryRunner.query(
      `ALTER TABLE events ADD COLUMN IF NOT EXISTS online_confirm_closes_at TIMESTAMPTZ`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE events DROP COLUMN IF EXISTS online_confirm_closes_at`,
    );
  }
}
