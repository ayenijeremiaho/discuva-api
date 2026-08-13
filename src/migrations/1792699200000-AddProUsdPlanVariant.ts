import { MigrationInterface, QueryRunner } from 'typeorm';

// First real multi-currency plan variant: 'pro-usd' is a net-new row, never
// a rename of 'pro' — subscriptions.plan_id is a real FK to plans(id), so
// existing subscribers on 'pro' must keep resolving to that exact id.
// Clones name/features/feature_limits from 'pro' at migration time via
// INSERT ... SELECT so the two variants start in sync; they're independent
// rows from here on (a future feature/limit change to one does not
// propagate to the other automatically). price_cents is a deliberate
// product decision ($29/mo), not a currency conversion of the NGN price.
export class AddProUsdPlanVariant1792699200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO plans (id, name, price_cents, currency, tier_key, features, feature_limits)
      SELECT 'pro-usd', name, 2900, 'USD', tier_key, features, feature_limits
      FROM plans
      WHERE id = 'pro'
        AND NOT EXISTS (SELECT 1 FROM plans WHERE id = 'pro-usd')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM plans WHERE id = 'pro-usd'`);
  }
}
