import { MigrationInterface, QueryRunner } from 'typeorm';

export class IndexFormResultsOrdering1806048000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE INDEX "IDX_form_submissions_results_recent" ON form_submissions (form_id, created_at DESC, id DESC)',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_form_submissions_results_score" ON form_submissions (form_id, score DESC NULLS LAST, created_at DESC, id DESC)',
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_form_submissions_results_score"');
    await queryRunner.query('DROP INDEX "IDX_form_submissions_results_recent"');
  }
}
