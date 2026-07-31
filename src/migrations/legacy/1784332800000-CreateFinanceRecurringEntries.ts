import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFinanceRecurringEntries1784332800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS finance_recurring_entries (
                id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                description          TEXT NOT NULL,
                debit_account_id     UUID NOT NULL REFERENCES finance_accounts(id) ON DELETE RESTRICT,
                credit_account_id    UUID NOT NULL REFERENCES finance_accounts(id) ON DELETE RESTRICT,
                amount               NUMERIC(15,2) NOT NULL,
                frequency            VARCHAR NOT NULL,
                fund_id              UUID NOT NULL REFERENCES finance_funds(id) ON DELETE RESTRICT,
                next_due_at          TIMESTAMPTZ NOT NULL,
                last_generated_at    TIMESTAMPTZ,
                is_active            BOOLEAN NOT NULL DEFAULT true,
                created_by_id        UUID NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
                created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_recurring_active_due ON finance_recurring_entries(next_due_at) WHERE is_active = true`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_recurring_fund ON finance_recurring_entries(fund_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_recurring_debit_account ON finance_recurring_entries(debit_account_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_recurring_credit_account ON finance_recurring_entries(credit_account_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_recurring_credit_account`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_recurring_debit_account`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_recurring_fund`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_recurring_active_due`);
    await queryRunner.query(`DROP TABLE IF EXISTS finance_recurring_entries`);
  }
}
