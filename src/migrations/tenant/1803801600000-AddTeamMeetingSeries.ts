import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTeamMeetingSeries1803801600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_meeting_series (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        space_id uuid NOT NULL REFERENCES team_spaces(id) ON DELETE CASCADE,
        title character varying NOT NULL,
        location character varying,
        online_link character varying,
        agenda text,
        frequency character varying NOT NULL,
        weekday smallint NOT NULL,
        start_time character varying(5) NOT NULL,
        end_time character varying(5),
        interval_weeks smallint NOT NULL DEFAULT 1,
        week_of_month smallint,
        starts_on date NOT NULL,
        ends_on date,
        active boolean NOT NULL DEFAULT true,
        created_by_id uuid REFERENCES members(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_meeting_series_space_id" ON team_meeting_series (space_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_meeting_series_created_by_id" ON team_meeting_series (created_by_id)`,
    );
    // The scheduler only ever looks at series still repeating.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_meeting_series_active" ON team_meeting_series (id) WHERE active`,
    );
    await queryRunner.query(
      `ALTER TABLE team_meetings ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES team_meeting_series(id) ON DELETE SET NULL`,
    );
    // A series' latest meeting, to know when to add the next.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_meetings_series_starts" ON team_meetings (series_id, starts_at DESC) WHERE series_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE team_meetings DROP COLUMN IF EXISTS series_id`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS team_meeting_series`);
  }
}
