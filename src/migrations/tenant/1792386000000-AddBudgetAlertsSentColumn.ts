import { MigrationInterface, QueryRunner } from 'typeorm';

// Budget alert thresholds became tenant-configurable (see ReminderSettingsService,
// BUDGET_ALERT key) instead of the fixed 80%/100% pair — an arbitrary-length
// threshold list needs a matching data structure, not two fixed boolean-ish
// columns. Backfills from the old columns so budgets that already crossed a
// threshold under the old system don't get re-alerted immediately after this
// ships. The old columns are left in place (unused by application code going
// forward, not read/written anymore) rather than dropped, to avoid
// irreversible data loss on this pre-existing, real-data table.
export class AddBudgetAlertsSentColumn1792386000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE finance_budgets
        ADD COLUMN IF NOT EXISTS alerts_sent JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
    await queryRunner.query(`
      UPDATE finance_budgets
      SET alerts_sent = COALESCE(
        (
          SELECT jsonb_agg(v)
          FROM (
            SELECT 80 AS v WHERE alert_80_sent_at IS NOT NULL
            UNION
            SELECT 100 AS v WHERE alert_100_sent_at IS NOT NULL
          ) thresholds
        ),
        '[]'::jsonb
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE finance_budgets DROP COLUMN IF EXISTS alerts_sent
    `);
  }
}
