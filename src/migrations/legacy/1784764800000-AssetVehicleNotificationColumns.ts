import { MigrationInterface, QueryRunner } from 'typeorm';

export class AssetVehicleNotificationColumns1784764800000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE assets
                ADD COLUMN IF NOT EXISTS insurance_notified_30_days_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS insurance_notified_14_days_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS insurance_notified_7_days_at  TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS insurance_notified_1_day_at   TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS roadworthiness_notified_30_days_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS roadworthiness_notified_14_days_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS roadworthiness_notified_7_days_at  TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS roadworthiness_notified_1_day_at   TIMESTAMPTZ
        `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE assets
                DROP COLUMN IF EXISTS insurance_notified_30_days_at,
                DROP COLUMN IF EXISTS insurance_notified_14_days_at,
                DROP COLUMN IF EXISTS insurance_notified_7_days_at,
                DROP COLUMN IF EXISTS insurance_notified_1_day_at,
                DROP COLUMN IF EXISTS roadworthiness_notified_30_days_at,
                DROP COLUMN IF EXISTS roadworthiness_notified_14_days_at,
                DROP COLUMN IF EXISTS roadworthiness_notified_7_days_at,
                DROP COLUMN IF EXISTS roadworthiness_notified_1_day_at
        `);
  }
}
