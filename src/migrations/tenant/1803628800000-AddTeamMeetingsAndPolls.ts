import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTeamMeetingsAndPolls1803628800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE team_posts ADD COLUMN IF NOT EXISTS type character varying NOT NULL DEFAULT 'POST'`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_meetings (
        post_id uuid PRIMARY KEY REFERENCES team_posts(id) ON DELETE CASCADE,
        space_id uuid NOT NULL REFERENCES team_spaces(id) ON DELETE CASCADE,
        title character varying NOT NULL,
        starts_at timestamptz NOT NULL,
        ends_at timestamptz,
        location character varying,
        online_link character varying,
        minutes text,
        minutes_updated_at timestamptz,
        minutes_by_id uuid REFERENCES members(id) ON DELETE SET NULL,
        cancelled_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    // A space's upcoming meetings, soonest first.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_meetings_space_starts" ON team_meetings (space_id, starts_at)`,
    );
    // Reminders and My Week: meetings that are still on, by start time.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_meetings_starts_active" ON team_meetings (starts_at) WHERE cancelled_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_meetings_minutes_by_id" ON team_meetings (minutes_by_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_meeting_rsvps (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        meeting_id uuid NOT NULL REFERENCES team_meetings(post_id) ON DELETE CASCADE,
        member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        response character varying,
        attended boolean,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_team_meeting_rsvps_meeting_member" UNIQUE (meeting_id, member_id)
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_meeting_rsvps_member_id" ON team_meeting_rsvps (member_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_polls (
        post_id uuid PRIMARY KEY REFERENCES team_posts(id) ON DELETE CASCADE,
        options jsonb NOT NULL,
        multiple boolean NOT NULL DEFAULT false,
        closes_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_poll_votes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        poll_id uuid NOT NULL REFERENCES team_polls(post_id) ON DELETE CASCADE,
        member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        option_ids character varying[] NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_team_poll_votes_poll_member" UNIQUE (poll_id, member_id)
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_poll_votes_member_id" ON team_poll_votes (member_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS team_poll_votes`);
    await queryRunner.query(`DROP TABLE IF EXISTS team_polls`);
    await queryRunner.query(`DROP TABLE IF EXISTS team_meeting_rsvps`);
    await queryRunner.query(`DROP TABLE IF EXISTS team_meetings`);
    await queryRunner.query(
      `ALTER TABLE team_posts DROP COLUMN IF EXISTS type`,
    );
  }
}
