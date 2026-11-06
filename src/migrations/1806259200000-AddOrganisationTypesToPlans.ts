import { MigrationInterface, QueryRunner } from 'typeorm';

// Groups get their own copy of every plan, priced as today, so their prices and features can change apart from churches'.
export class AddOrganisationTypesToPlans1806259200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE plans ADD COLUMN IF NOT EXISTS organisation_types text[] NOT NULL DEFAULT '{CHURCH,MINISTRY}'`,
    );
    await queryRunner.query(`
      INSERT INTO plans (id, name, price_cents, currency, tier_key, billing_interval, features, feature_limits, organisation_types)
      SELECT 'group-' || id, name, price_cents, currency, tier_key, billing_interval, features, feature_limits, '{GROUP}'
      FROM plans p
      WHERE id NOT LIKE 'group-%'
        AND NOT EXISTS (SELECT 1 FROM plans g WHERE g.id = 'group-' || p.id)
    `);
    await queryRunner.query(`
      UPDATE subscriptions s SET plan_id = 'group-free'
      FROM tenants t
      WHERE t.id = s.tenant_id AND t.org_type = 'GROUP' AND s.plan_id = 'free'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE subscriptions SET plan_id = substr(plan_id, 7) WHERE plan_id LIKE 'group-%'`,
    );
    await queryRunner.query(`DELETE FROM plans WHERE id LIKE 'group-%'`);
    await queryRunner.query(
      `ALTER TABLE plans DROP COLUMN IF EXISTS organisation_types`,
    );
  }
}
