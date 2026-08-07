import { MigrationInterface, QueryRunner } from 'typeorm';

// Control-plane changes — `plans`, `subscriptions`, `feature_usages` all
// live in `public`, never a `search_path` target.
//
// subscriptions.discount_*: an internal comp set by a platform admin
// (PlatformTenantService.applyDiscount/removeDiscount) — never touches
// checkout or a payment provider, see subscription.entity.ts's discountType
// comment. Factored into PlatformAnalyticsService.mrrCents().
//
// plans.feature_limits: admin-configurable numeric cap per PlanFeature,
// layered on top of the existing boolean `features` array — see
// plan.entity.ts. Absent key = unlimited for that feature.
//
// feature_usages: lifetime per-tenant-per-feature usage count PlanGuard
// checks/increments against plans.feature_limits — see feature-usage.entity.ts.
export class AddDiscountsAndFeatureUsage1791849600000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE subscriptions
      ADD COLUMN IF NOT EXISTS discount_type VARCHAR NULL,
      ADD COLUMN IF NOT EXISTS discount_value INTEGER NULL,
      ADD COLUMN IF NOT EXISTS discount_reason VARCHAR NULL,
      ADD COLUMN IF NOT EXISTS discount_expires_at TIMESTAMPTZ NULL
    `);

    await queryRunner.query(`
      ALTER TABLE plans
      ADD COLUMN IF NOT EXISTS feature_limits JSONB NOT NULL DEFAULT '{}'::jsonb
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS feature_usages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        feature VARCHAR NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_feature_usages_tenant_feature UNIQUE (tenant_id, feature)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS feature_usages`);
    await queryRunner.query(`
      ALTER TABLE plans DROP COLUMN IF EXISTS feature_limits
    `);
    await queryRunner.query(`
      ALTER TABLE subscriptions
      DROP COLUMN IF EXISTS discount_type,
      DROP COLUMN IF EXISTS discount_value,
      DROP COLUMN IF EXISTS discount_reason,
      DROP COLUMN IF EXISTS discount_expires_at
    `);
  }
}
