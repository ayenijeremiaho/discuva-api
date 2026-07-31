import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFinanceAccounts1783814400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS finance_accounts (
                id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name                      VARCHAR NOT NULL,
                type                      VARCHAR NOT NULL,
                subtype                   VARCHAR NOT NULL,
                normal_balance            VARCHAR NOT NULL,
                fund_id                   UUID REFERENCES finance_funds(id) ON DELETE SET NULL,
                current_balance           NUMERIC(15,2) NOT NULL DEFAULT 0,
                low_balance_alert_threshold NUMERIC(15,2),
                description               TEXT,
                bank_name                 VARCHAR,
                account_number            VARCHAR,
                is_active                 BOOLEAN NOT NULL DEFAULT true,
                created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
                CONSTRAINT chk_account_balance_non_negative CHECK (current_balance >= -0.01)
            )
        `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_fin_accounts_fund ON finance_accounts(fund_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_fin_accounts_type_active ON finance_accounts(type, is_active)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_fin_accounts_subtype ON finance_accounts(subtype)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_fin_accounts_subtype`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_fin_accounts_type_active`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_fin_accounts_fund`);
    await queryRunner.query(`DROP TABLE IF EXISTS finance_accounts`);
  }
}
