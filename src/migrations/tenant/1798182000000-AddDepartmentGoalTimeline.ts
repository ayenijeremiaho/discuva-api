import { MigrationInterface, QueryRunner } from 'typeorm';

// "Timeline to Achieve Target" — the third column of the KPI table this
// feature was modeled on (KPI | KPI Description | Timeline to Achieve
// Target). `title`/`description` already existed and are only relabeled
// in the UI (KPI / KPI Description) — no migration needed for those.
// Freeform text, not a date: see the entity's own comment.
export class AddDepartmentGoalTimeline1798182000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE department_goals ADD timeline_to_achieve text
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE department_goals DROP COLUMN timeline_to_achieve
    `);
  }
}
