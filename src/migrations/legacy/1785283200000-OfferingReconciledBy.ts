import { MigrationInterface, QueryRunner } from 'typeorm';

export class OfferingReconciledBy1785283200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE finance_offerings
            ADD COLUMN reconciled_by_id UUID REFERENCES admins(id) ON DELETE SET NULL
        `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE finance_offerings DROP COLUMN IF EXISTS reconciled_by_id`,
    );
  }
}
