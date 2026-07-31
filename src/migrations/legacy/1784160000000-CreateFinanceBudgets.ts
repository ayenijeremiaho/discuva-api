import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFinanceBudgets1784160000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS finance_budgets (
                id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name           VARCHAR NOT NULL,
                fund_id        UUID NOT NULL REFERENCES finance_funds(id) ON DELETE RESTRICT,
                account_id     UUID NOT NULL REFERENCES finance_accounts(id) ON DELETE RESTRICT,
                period         VARCHAR NOT NULL,
                amount         NUMERIC(15,2) NOT NULL,
                start_date     DATE NOT NULL,
                end_date       DATE NOT NULL,
                is_active      BOOLEAN NOT NULL DEFAULT true,
                created_by_id  UUID NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
                created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_budgets_fund ON finance_budgets(fund_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_budgets_account ON finance_budgets(account_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_budgets_period_active ON finance_budgets(period, is_active)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_budgets_date_range ON finance_budgets(start_date, end_date)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_budgets_date_range`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_budgets_period_active`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_budgets_account`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_budgets_fund`);
    await queryRunner.query(`DROP TABLE IF EXISTS finance_budgets`);
  }
}
