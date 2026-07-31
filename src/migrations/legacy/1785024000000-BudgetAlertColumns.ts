import { MigrationInterface, QueryRunner } from 'typeorm';

export class BudgetAlertColumns1785024000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE finance_budgets
                ADD COLUMN IF NOT EXISTS alert_80_sent_at  TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS alert_100_sent_at TIMESTAMPTZ
        `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE finance_budgets
                DROP COLUMN IF EXISTS alert_80_sent_at,
                DROP COLUMN IF EXISTS alert_100_sent_at
        `);
  }
}
