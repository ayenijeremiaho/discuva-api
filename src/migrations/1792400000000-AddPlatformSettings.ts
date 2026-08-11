import { MigrationInterface, QueryRunner } from 'typeorm';

// Control-plane table — lives in `public`, never a `search_path` target.
// Generic key/jsonb store for platform-wide values a platform admin can
// edit live instead of via env var + redeploy — mirrors ChurchSetting's
// shape (per-tenant equivalent) but with no tenant dimension. First (only,
// for now) consumer: subscription grace period days, replacing the
// GRACE_PERIOD_DAYS env var — see SubscriptionLapseScheduler.
export class AddPlatformSettings1792400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        key character varying NOT NULL UNIQUE,
        value jsonb NOT NULL,
        created_at timestamp with time zone DEFAULT now() NOT NULL,
        updated_at timestamp with time zone DEFAULT now() NOT NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS platform_settings`);
  }
}
