import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFinanceCategoryIsActive1798873200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE finance_categories ADD is_active boolean NOT NULL DEFAULT true
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE finance_categories DROP COLUMN is_active
    `);
  }
}
