import { MigrationInterface, QueryRunner } from 'typeorm';

// Tenant-schema change. Optional helper text shown under a field's label
// while filling out the form — distinct from Form.description, which
// introduces the form as a whole.
export class AddFormFieldDescription1794898800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE form_fields ADD COLUMN description text NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE form_fields DROP COLUMN description`);
  }
}
