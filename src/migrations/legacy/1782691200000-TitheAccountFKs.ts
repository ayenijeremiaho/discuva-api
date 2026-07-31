import { MigrationInterface, QueryRunner } from 'typeorm';

export class TitheAccountFKs1782691200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // Product is in testing — clear existing tithe data before adding non-nullable FKs
    await queryRunner.query(`TRUNCATE TABLE tithe_upload_batches CASCADE`);
    await queryRunner.query(`TRUNCATE TABLE tithe_payment_proofs`);

    // tithe_upload_batches: add tithe_account_id (non-nullable)
    await queryRunner.query(`
            ALTER TABLE tithe_upload_batches
            ADD COLUMN tithe_account_id uuid NOT NULL
            REFERENCES tithe_accounts(id) ON DELETE RESTRICT
        `);
    await queryRunner.query(
      `CREATE INDEX idx_tithe_upload_batches_tithe_account_id ON tithe_upload_batches (tithe_account_id)`,
    );

    // tithe_payment_proofs: drop bank_name, add tithe_account_id (non-nullable), add indexes
    await queryRunner.query(
      `ALTER TABLE tithe_payment_proofs DROP COLUMN bank_name`,
    );
    await queryRunner.query(`
            ALTER TABLE tithe_payment_proofs
            ADD COLUMN tithe_account_id uuid NOT NULL
            REFERENCES tithe_accounts(id) ON DELETE RESTRICT
        `);
    await queryRunner.query(
      `CREATE INDEX idx_tithe_payment_proofs_tithe_account_id ON tithe_payment_proofs (tithe_account_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_tithe_payment_proofs_payment_date ON tithe_payment_proofs (payment_date)`,
    );

    // tithe_records: add payment_date index for summary range queries
    await queryRunner.query(
      `CREATE INDEX idx_tithe_records_payment_date ON tithe_records (payment_date)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_tithe_records_payment_date`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_tithe_payment_proofs_payment_date`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_tithe_payment_proofs_tithe_account_id`,
    );
    await queryRunner.query(
      `ALTER TABLE tithe_payment_proofs DROP COLUMN IF EXISTS tithe_account_id`,
    );
    await queryRunner.query(
      `ALTER TABLE tithe_payment_proofs ADD COLUMN IF NOT EXISTS bank_name character varying`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_tithe_upload_batches_tithe_account_id`,
    );
    await queryRunner.query(
      `ALTER TABLE tithe_upload_batches DROP COLUMN IF EXISTS tithe_account_id`,
    );
  }
}
