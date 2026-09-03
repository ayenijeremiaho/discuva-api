import { MigrationInterface, QueryRunner } from 'typeorm';

// Tenant-schema change. FormSubmissionService.getMySubmission (added
// alongside Form.editableAfterSubmit) queries form_submissions by
// (form_id, member_id) together, ordered by created_at — the "you already
// submitted this form, want to edit it?" lookup. The base AddForms
// migration only ever indexed form_id and member_id separately, which
// forces a bitmap AND across two indexes instead of a single index scan.
export class AddFormSubmissionsMemberFormIndex1795676400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_form_submissions_form_id_member_id"
        ON form_submissions (form_id, member_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_form_submissions_form_id_member_id"`,
    );
  }
}
