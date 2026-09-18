import { MigrationInterface, QueryRunner } from 'typeorm';

// Weighted per-question marks for a QUIZ — every question was previously
// worth a flat 1 point (FormSubmissionService.scoreQuizSubmission). Nullable
// so every existing field (and every field on a non-QUIZ form) is
// unaffected — `points ?? 1` in the scoring service preserves today's
// behaviour exactly.
export class AddFormFieldPoints1798095600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE form_fields ADD points smallint
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE form_fields DROP COLUMN points
    `);
  }
}
