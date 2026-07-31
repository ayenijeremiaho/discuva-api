import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFinanceOfferings1784073600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS finance_offerings (
                id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                service_event_id          UUID,
                fund_id                   UUID NOT NULL REFERENCES finance_funds(id) ON DELETE RESTRICT,
                type                      VARCHAR NOT NULL,
                cash_amount               NUMERIC(15,2) NOT NULL DEFAULT 0,
                expected_transfer_amount  NUMERIC(15,2) NOT NULL DEFAULT 0,
                is_reconciled             BOOLEAN NOT NULL DEFAULT false,
                reconciled_at             TIMESTAMPTZ,
                notes                     TEXT,
                recorded_by_id            UUID NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
                created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_offerings_service_event ON finance_offerings(service_event_id) WHERE service_event_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_offerings_fund ON finance_offerings(fund_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_offerings_type ON finance_offerings(type)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_offerings_reconciled ON finance_offerings(is_reconciled)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_offerings_recorded_by ON finance_offerings(recorded_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_offerings_created_at ON finance_offerings(created_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_offerings_created_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_offerings_recorded_by`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_offerings_reconciled`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_offerings_type`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_offerings_fund`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_offerings_service_event`);
    await queryRunner.query(`DROP TABLE IF EXISTS finance_offerings`);
  }
}
