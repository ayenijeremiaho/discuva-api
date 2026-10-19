import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTeamPulse1803456000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_pulses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        title character varying NOT NULL,
        questions jsonb NOT NULL,
        frequency character varying NOT NULL DEFAULT 'ONCE',
        response_window_days smallint NOT NULL DEFAULT 3,
        required boolean NOT NULL DEFAULT false,
        active boolean NOT NULL DEFAULT true,
        next_open_at timestamptz,
        created_by_id uuid REFERENCES members(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_pulses_department_id" ON team_pulses (department_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_pulses_created_by_id" ON team_pulses (created_by_id)`,
    );
    // The scheduler's only question: which pulses are due to open next.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_pulses_next_open_due" ON team_pulses (next_open_at) WHERE active AND next_open_at IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_pulse_rounds (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        pulse_id uuid NOT NULL REFERENCES team_pulses(id) ON DELETE CASCADE,
        opens_at timestamptz NOT NULL,
        closes_at timestamptz NOT NULL,
        invited_count integer NOT NULL DEFAULT 0,
        response_count integer NOT NULL DEFAULT 0,
        ratings jsonb NOT NULL DEFAULT '{}',
        comments jsonb NOT NULL DEFAULT '{}',
        reminder_sent_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_pulse_rounds_pulse_opens" ON team_pulse_rounds (pulse_id, opens_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_pulse_rounds_closes_at" ON team_pulse_rounds (closes_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_pulse_participations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        round_id uuid NOT NULL REFERENCES team_pulse_rounds(id) ON DELETE CASCADE,
        member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_team_pulse_participations_round_member" UNIQUE (round_id, member_id)
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_pulse_participations_member_id" ON team_pulse_participations (member_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS team_pulse_participations`);
    await queryRunner.query(`DROP TABLE IF EXISTS team_pulse_rounds`);
    await queryRunner.query(`DROP TABLE IF EXISTS team_pulses`);
  }
}
