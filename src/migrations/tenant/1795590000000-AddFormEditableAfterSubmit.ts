import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFormEditableAfterSubmit1795590000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE forms ADD editable_after_submit boolean NOT NULL DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE forms DROP COLUMN editable_after_submit
    `);
  }
}
