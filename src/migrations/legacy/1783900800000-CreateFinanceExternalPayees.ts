import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFinanceExternalPayees1783900800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS finance_external_payees (
                id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name                VARCHAR NOT NULL,
                type                VARCHAR NOT NULL,
                contact_email       VARCHAR,
                contact_phone       VARCHAR,
                account_number      VARCHAR,
                bank_name           VARCHAR,
                registration_number VARCHAR,
                notes               TEXT,
                is_active           BOOLEAN NOT NULL DEFAULT true,
                created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_ext_payees_type ON finance_external_payees(type)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_ext_payees_active ON finance_external_payees(is_active) WHERE is_active = true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ext_payees_active`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ext_payees_type`);
    await queryRunner.query(`DROP TABLE IF EXISTS finance_external_payees`);
  }
}
