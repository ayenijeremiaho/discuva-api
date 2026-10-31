import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTeamMeetingActions1804924800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE team_meeting_actions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        meeting_id uuid NOT NULL REFERENCES team_meetings(post_id) ON DELETE CASCADE,
        text varchar(300) NOT NULL,
        assignee_id uuid REFERENCES members(id) ON DELETE SET NULL,
        due_date date,
        done_at timestamptz,
        created_by_id uuid REFERENCES members(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_team_meeting_actions_meeting" ON team_meeting_actions (meeting_id, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_team_meeting_actions_open_assignee" ON team_meeting_actions (assignee_id, due_date) WHERE done_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_team_meeting_actions_created_by" ON team_meeting_actions (created_by_id)`,
    );
    await queryRunner.query(
      `ALTER TABLE team_meetings ADD COLUMN summary_sent_at timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE team_meetings DROP COLUMN summary_sent_at`,
    );
    await queryRunner.query(`DROP TABLE team_meeting_actions`);
  }
}
