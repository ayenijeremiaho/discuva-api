import { MigrationInterface, QueryRunner } from 'typeorm';

// Same reasoning as AddBudgetAlertsSentColumn / AddMaintenanceNotifiedThresholds:
// warranty (ReminderSettingKey.ASSET_WARRANTY) and vehicle insurance/
// roadworthiness (ReminderSettingKey.VEHICLE_EXPIRY) alert thresholds became
// tenant-configurable instead of the fixed 30/14/7/1-day columns. Backfills
// from the old columns; old columns left in place, unused.
export class AddAssetExpiryNotifiedThresholds1792393200000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE assets
        ADD COLUMN IF NOT EXISTS warranty_notified_thresholds JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS insurance_notified_thresholds JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS roadworthiness_notified_thresholds JSONB NOT NULL DEFAULT '[]'::jsonb
    `);

    await queryRunner.query(`
      UPDATE assets
      SET warranty_notified_thresholds = COALESCE(
        (
          SELECT jsonb_agg(v)
          FROM (
            SELECT 30 AS v WHERE warranty_notified_30_days_at IS NOT NULL
            UNION SELECT 14 WHERE warranty_notified_14_days_at IS NOT NULL
            UNION SELECT 7 WHERE warranty_notified_7_days_at IS NOT NULL
            UNION SELECT 1 WHERE warranty_notified_1_day_at IS NOT NULL
          ) t
        ),
        '[]'::jsonb
      )
    `);

    await queryRunner.query(`
      UPDATE assets
      SET insurance_notified_thresholds = COALESCE(
        (
          SELECT jsonb_agg(v)
          FROM (
            SELECT 30 AS v WHERE insurance_notified_30_days_at IS NOT NULL
            UNION SELECT 14 WHERE insurance_notified_14_days_at IS NOT NULL
            UNION SELECT 7 WHERE insurance_notified_7_days_at IS NOT NULL
            UNION SELECT 1 WHERE insurance_notified_1_day_at IS NOT NULL
          ) t
        ),
        '[]'::jsonb
      )
    `);

    await queryRunner.query(`
      UPDATE assets
      SET roadworthiness_notified_thresholds = COALESCE(
        (
          SELECT jsonb_agg(v)
          FROM (
            SELECT 30 AS v WHERE roadworthiness_notified_30_days_at IS NOT NULL
            UNION SELECT 14 WHERE roadworthiness_notified_14_days_at IS NOT NULL
            UNION SELECT 7 WHERE roadworthiness_notified_7_days_at IS NOT NULL
            UNION SELECT 1 WHERE roadworthiness_notified_1_day_at IS NOT NULL
          ) t
        ),
        '[]'::jsonb
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE assets
        DROP COLUMN IF EXISTS warranty_notified_thresholds,
        DROP COLUMN IF EXISTS insurance_notified_thresholds,
        DROP COLUMN IF EXISTS roadworthiness_notified_thresholds
    `);
  }
}
