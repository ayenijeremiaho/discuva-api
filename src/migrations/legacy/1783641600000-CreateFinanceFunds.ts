import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFinanceFunds1783641600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS finance_funds (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name        VARCHAR NOT NULL,
                type        VARCHAR NOT NULL,
                description TEXT,
                is_active   BOOLEAN NOT NULL DEFAULT true,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_funds_type ON finance_funds(type)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_funds_active ON finance_funds(is_active) WHERE is_active = true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_finance_funds_active`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_finance_funds_type`);
    await queryRunner.query(`DROP TABLE IF EXISTS finance_funds`);
  }
}
