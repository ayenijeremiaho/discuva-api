import { MigrationInterface, QueryRunner } from 'typeorm';

// Tenant-schema change. A form's always-shown second call-to-action —
// e.g. "Join the Main Volunteer Group" — distinct from the per-option
// link a nextStepsField resolves. Both render on the post-submission
// screen; this one is form-level and shown to every submitter regardless
// of what they answered.
export class AddFormGeneralAction1794639600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE forms
        ADD COLUMN general_action_url   VARCHAR NULL,
        ADD COLUMN general_action_label VARCHAR NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE forms
        DROP COLUMN general_action_url,
        DROP COLUMN general_action_label
    `);
  }
}
