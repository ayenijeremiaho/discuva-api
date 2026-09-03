import { MigrationInterface, QueryRunner } from 'typeorm';

// Tenant-schema change. forms.dedup_field_id and forms.next_steps_field_id
// are real FK columns (REFERENCES form_fields(id) ON DELETE SET NULL,
// added in AddFormRegistrationEnhancements) that never got an index —
// their sibling audience_group_id, added in that same migration, did.
// Without these, deleting a FormField requires Postgres to scan every row
// in forms to find and null out any reference to the row being deleted.
export class AddFormDedupNextStepsFieldIndexes1794985200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_forms_dedup_field_id" ON forms(dedup_field_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_forms_next_steps_field_id" ON forms(next_steps_field_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_forms_next_steps_field_id"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_forms_dedup_field_id"`);
  }
}
