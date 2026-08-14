import { MigrationInterface, QueryRunner } from 'typeorm';

// Net-new rows, never a rename of 'pro'/'pro-usd' — subscriptions.plan_id
// is a real FK to plans(id). Prices are deliberate decisions (2 months
// free vs 12x monthly), not a computed discount off the monthly price.
export class AddAnnualProPlanVariants1792872000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO plans (id, name, price_cents, currency, tier_key, billing_interval, features, feature_limits)
      SELECT 'pro-annual', name, 50000000, 'NGN', tier_key, 'annual', features, feature_limits
      FROM plans
      WHERE id = 'pro'
        AND NOT EXISTS (SELECT 1 FROM plans WHERE id = 'pro-annual')
    `);
    await queryRunner.query(`
      INSERT INTO plans (id, name, price_cents, currency, tier_key, billing_interval, features, feature_limits)
      SELECT 'pro-usd-annual', name, 29000, 'USD', tier_key, 'annual', features, feature_limits
      FROM plans
      WHERE id = 'pro-usd'
        AND NOT EXISTS (SELECT 1 FROM plans WHERE id = 'pro-usd-annual')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM plans WHERE id IN ('pro-annual', 'pro-usd-annual')`,
    );
  }
}
