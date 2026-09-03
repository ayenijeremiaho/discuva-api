import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFormFieldValidationRegex1795417200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE form_fields
        ADD validation_regex VARCHAR NULL,
        ADD validation_message VARCHAR NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE form_fields
        DROP COLUMN validation_regex,
        DROP COLUMN validation_message
    `);
  }
}
