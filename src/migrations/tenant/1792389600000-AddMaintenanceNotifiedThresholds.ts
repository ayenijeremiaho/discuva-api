import { MigrationInterface, QueryRunner } from 'typeorm';

// Same reasoning as AddBudgetAlertsSentColumn: maintenance reminder
// thresholds became tenant-configurable (ReminderSettingKey.ASSET_MAINTENANCE)
// instead of the fixed 7/3/1/0-day columns. Backfills from the old columns.
// `last_overdue_notified_at` is untouched — the overdue nag stays an
// unconditional daily notice, not part of the configurable threshold list
// (see ReminderSettingKey.ASSET_MAINTENANCE's "days before due" unit — it
// deliberately doesn't cover overdue). Old columns left in place, unused.
export class AddMaintenanceNotifiedThresholds1792389600000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE asset_maintenance_schedules
        ADD COLUMN IF NOT EXISTS notified_thresholds JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
    await queryRunner.query(`
      UPDATE asset_maintenance_schedules
      SET notified_thresholds = COALESCE(
        (
          SELECT jsonb_agg(v)
          FROM (
            SELECT 7 AS v WHERE notified_7_days_at IS NOT NULL
            UNION
            SELECT 3 AS v WHERE notified_3_days_at IS NOT NULL
            UNION
            SELECT 1 AS v WHERE notified_1_day_at IS NOT NULL
            UNION
            SELECT 0 AS v WHERE notified_due_day_at IS NOT NULL
          ) thresholds
        ),
        '[]'::jsonb
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE asset_maintenance_schedules DROP COLUMN IF EXISTS notified_thresholds
    `);
  }
}
