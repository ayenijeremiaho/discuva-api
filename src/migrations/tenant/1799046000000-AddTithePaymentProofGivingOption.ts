import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTithePaymentProofGivingOption1799046000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tithe_payment_proofs ADD giving_option_id uuid NULL
        REFERENCES finance_giving_options(id) ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_tithe_payment_proofs_giving_option_id" ON tithe_payment_proofs (giving_option_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_tithe_payment_proofs_giving_option_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE tithe_payment_proofs DROP COLUMN giving_option_id
    `);
  }
}
