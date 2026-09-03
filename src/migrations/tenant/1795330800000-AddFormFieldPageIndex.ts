import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFormFieldPageIndex1795330800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE form_fields ADD page_index smallint NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE form_fields DROP COLUMN page_index
    `);
  }
}
