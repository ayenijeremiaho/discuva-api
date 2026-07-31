import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFinanceAccountingPeriods1783728000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS finance_accounting_periods (
                id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                year         INT NOT NULL,
                month        INT NOT NULL,
                status       VARCHAR NOT NULL DEFAULT 'OPEN',
                closed_at    TIMESTAMPTZ,
                closed_by_id UUID REFERENCES admins(id) ON DELETE SET NULL,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
                CONSTRAINT uq_accounting_period UNIQUE (year, month)
            )
        `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_acc_periods_status ON finance_accounting_periods(status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_acc_periods_year_month ON finance_accounting_periods(year, month)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_acc_periods_year_month`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_acc_periods_status`);
    await queryRunner.query(`DROP TABLE IF EXISTS finance_accounting_periods`);
  }
}
