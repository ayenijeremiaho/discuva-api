import { MigrationInterface, QueryRunner } from 'typeorm';

// The newcomer journey checks each first-timer's follow-up task; this was the one lookup without an index.
export class AddFollowUpTaskFirstTimerIndex1803888000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_follow_up_tasks_first_timer_id" ON follow_up_tasks (first_timer_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_follow_up_tasks_first_timer_id"`,
    );
  }
}
