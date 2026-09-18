import { MigrationInterface, QueryRunner } from 'typeorm';

// Cleanup after AddFormQuizVotingSupport (1797836400000) — two of its five
// indexes turned out to be unused: form_attempts.form_id is redundant
// against the (form_id, member_id) composite it also created, and
// form_attempts.member_id would only serve a member hard-delete cascade
// that CLAUDE.md's Member Deletion Policy forbids ever existing.
// forms.purpose is deliberately NOT dropped here (an earlier draft of this
// migration did) — FormService.listForms (added alongside
// AddFormListSearchSupport, right after this one) filters on it
// server-side, so it stays a real, used index. form_attempts.submission_id
// is also deliberately KEPT — Form.delete() cascades forms ->
// form_submissions (ON DELETE CASCADE) -> form_attempts.submission_id (ON
// DELETE SET NULL), so it backs a real, currently-exercised "Delete Form"
// path.
export class DropUnusedFormIndexes1797922800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_form_attempts_form_id"`);
    await queryRunner.query(`DROP INDEX "IDX_form_attempts_member_id"`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_form_attempts_member_id" ON form_attempts (member_id)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_form_attempts_form_id" ON form_attempts (form_id)
    `);
  }
}
