import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFormFieldVisibilityRule1795503600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE form_fields ADD visibility_rule jsonb NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE form_fields DROP COLUMN visibility_rule
    `);
  }
}
