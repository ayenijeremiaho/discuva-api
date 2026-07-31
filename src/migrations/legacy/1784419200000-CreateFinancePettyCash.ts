import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFinancePettyCash1784419200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS finance_petty_cash_replenishments (
                id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                from_account_id   UUID NOT NULL REFERENCES finance_accounts(id) ON DELETE RESTRICT,
                to_cash_account_id UUID NOT NULL REFERENCES finance_accounts(id) ON DELETE RESTRICT,
                amount            NUMERIC(15,2) NOT NULL,
                status            VARCHAR NOT NULL DEFAULT 'PENDING',
                notes             TEXT,
                requested_by_id   UUID NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
                approved_by_id    UUID REFERENCES admins(id) ON DELETE SET NULL,
                approved_at       TIMESTAMPTZ,
                created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_petty_cash_status ON finance_petty_cash_replenishments(status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_petty_cash_requested_by ON finance_petty_cash_replenishments(requested_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_petty_cash_from_account ON finance_petty_cash_replenishments(from_account_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_petty_cash_to_account ON finance_petty_cash_replenishments(to_cash_account_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_petty_cash_to_account`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_petty_cash_from_account`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_petty_cash_requested_by`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_petty_cash_status`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS finance_petty_cash_replenishments`,
    );
  }
}
