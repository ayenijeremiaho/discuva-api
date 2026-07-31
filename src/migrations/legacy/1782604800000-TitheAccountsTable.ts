import { MigrationInterface, QueryRunner } from 'typeorm';

export class TitheAccountsTable1782604800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE tithe_accounts (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                bank_name character varying NOT NULL,
                account_number character varying NOT NULL,
                account_name character varying NOT NULL,
                currency character varying NOT NULL,
                description character varying,
                is_active boolean NOT NULL DEFAULT true,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            )
        `);
    await queryRunner.query(
      `CREATE INDEX idx_tithe_accounts_currency ON tithe_accounts (currency)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_tithe_accounts_is_active ON tithe_accounts (is_active)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_tithe_accounts_account_number ON tithe_accounts (account_number)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tithe_accounts`);
  }
}
