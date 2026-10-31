import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTeamMeetingActionReminder1805011200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE team_meeting_actions ADD COLUMN due_reminded_at timestamptz`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_team_meeting_actions_due_unreminded" ON team_meeting_actions (due_date)
       WHERE done_at IS NULL AND due_reminded_at IS NULL AND due_date IS NOT NULL AND assignee_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_team_meeting_actions_due_unreminded"`,
    );
    await queryRunner.query(
      `ALTER TABLE team_meeting_actions DROP COLUMN due_reminded_at`,
    );
  }
}
