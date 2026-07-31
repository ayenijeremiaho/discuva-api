import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFirstTimerConversionFields1786320000000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE first_timers ADD COLUMN converted_member_id UUID`,
    );
    await queryRunner.query(
      `ALTER TABLE first_timers ADD COLUMN converted_at TIMESTAMPTZ`,
    );
    await queryRunner.query(
      `ALTER TABLE first_timers ADD COLUMN invite_sent_at TIMESTAMPTZ`,
    );
    await queryRunner.query(
      `ALTER TABLE first_timers
       ADD CONSTRAINT fk_first_timers_converted_member
       FOREIGN KEY (converted_member_id) REFERENCES members(id) ON DELETE SET NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE first_timers DROP CONSTRAINT fk_first_timers_converted_member`,
    );
    await queryRunner.query(
      `ALTER TABLE first_timers DROP COLUMN invite_sent_at`,
    );
    await queryRunner.query(
      `ALTER TABLE first_timers DROP COLUMN converted_at`,
    );
    await queryRunner.query(
      `ALTER TABLE first_timers DROP COLUMN converted_member_id`,
    );
  }
}
