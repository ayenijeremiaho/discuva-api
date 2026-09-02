import { MigrationInterface, QueryRunner } from 'typeorm';

// Tenant-schema change. Extends the Forms module with: form-level cover
// image/logo branding, restricting a MEMBERS-visibility form to a specific
// Group ("Contact List"), a designated field to dedupe submissions by
// (e.g. a phone-number field), and a designated DROPDOWN field whose
// selected option's metadata (url/description) drives a dynamic
// post-submission "next steps" response instead of a static thank-you.
export class AddFormRegistrationEnhancements1794553200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE forms
        ADD COLUMN cover_image_url      VARCHAR NULL,
        ADD COLUMN cover_image_public_id VARCHAR NULL,
        ADD COLUMN logo_url             VARCHAR NULL,
        ADD COLUMN logo_public_id       VARCHAR NULL,
        ADD COLUMN audience_group_id    UUID NULL REFERENCES groups(id) ON DELETE SET NULL,
        ADD COLUMN dedup_field_id       UUID NULL REFERENCES form_fields(id) ON DELETE SET NULL,
        ADD COLUMN next_steps_field_id  UUID NULL REFERENCES form_fields(id) ON DELETE SET NULL,
        ADD COLUMN post_submit_message  VARCHAR NULL
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_forms_audience_group_id" ON forms(audience_group_id)`,
    );

    await queryRunner.query(`
      ALTER TABLE form_fields
        ADD COLUMN option_metadata JSONB NULL
    `);

    await queryRunner.query(`
      ALTER TABLE form_submissions
        ADD COLUMN dedup_value_normalized VARCHAR NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_form_submissions_dedup
        ON form_submissions (form_id, dedup_value_normalized)
        WHERE dedup_value_normalized IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_form_submissions_dedup`);
    await queryRunner.query(`
      ALTER TABLE form_submissions DROP COLUMN dedup_value_normalized
    `);

    await queryRunner.query(`
      ALTER TABLE form_fields DROP COLUMN option_metadata
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_forms_audience_group_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE forms
        DROP COLUMN cover_image_url,
        DROP COLUMN cover_image_public_id,
        DROP COLUMN logo_url,
        DROP COLUMN logo_public_id,
        DROP COLUMN audience_group_id,
        DROP COLUMN dedup_field_id,
        DROP COLUMN next_steps_field_id,
        DROP COLUMN post_submit_message
    `);
  }
}
