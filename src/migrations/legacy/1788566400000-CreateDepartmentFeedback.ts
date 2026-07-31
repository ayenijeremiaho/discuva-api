import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDepartmentFeedback1788566400000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE department_feedback (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        submitted_by_id UUID REFERENCES worker_profiles(id) ON DELETE SET NULL,
        submitted_by_name character varying NOT NULL,
        week_of DATE NOT NULL,
        attendance_notes text NOT NULL,
        highlights text NOT NULL,
        challenges text NOT NULL,
        prayer_requests text,
        additional_notes text,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        responded_by_pastor_id UUID REFERENCES pastors(id) ON DELETE SET NULL,
        responded_by_pastor_name character varying,
        pastor_response text,
        pastor_responded_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_department_feedback_department_week" UNIQUE (department_id, week_of)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_department_feedback_department_id" ON department_feedback (department_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_department_feedback_week_of" ON department_feedback (week_of)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE department_feedback`);
  }
}
