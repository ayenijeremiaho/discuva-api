import { MigrationInterface, QueryRunner } from 'typeorm';

// When a church's current plan began. Set by trigger rather than in code because eight paths change a plan
// (checkout, cancellations, lapse, branch links, manual changes, signup); a renewal on the same plan keeps the date.
// Backfilled from the latest completed checkout for the current plan, else when the subscription row was created.
export class AddSubscriptionPlanStartedAt1794772806000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan_started_at TIMESTAMPTZ`,
    );
    await queryRunner.query(`
      UPDATE subscriptions s
         SET plan_started_at = COALESCE(
           (SELECT max(b.completed_at) FROM billing_checkout_sessions b
             WHERE b.tenant_id = s.tenant_id AND b.plan_id = s.plan_id
               AND b.type = 'subscription' AND b.status = 'completed'),
           s.created_at)
       WHERE plan_started_at IS NULL`);
    await queryRunner.query(
      `ALTER TABLE subscriptions ALTER COLUMN plan_started_at SET DEFAULT now(), ALTER COLUMN plan_started_at SET NOT NULL`,
    );
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION subscriptions_set_plan_started_at() RETURNS trigger AS $$
      BEGIN
        IF NEW.plan_id IS DISTINCT FROM OLD.plan_id
           OR (NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active') THEN
          NEW.plan_started_at := now();
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_subscriptions_plan_started_at ON subscriptions`,
    );
    await queryRunner.query(`
      CREATE TRIGGER trg_subscriptions_plan_started_at
        BEFORE UPDATE ON subscriptions
        FOR EACH ROW EXECUTE FUNCTION subscriptions_set_plan_started_at()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_subscriptions_plan_started_at ON subscriptions`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS subscriptions_set_plan_started_at()`,
    );
    await queryRunner.query(
      `ALTER TABLE subscriptions DROP COLUMN IF EXISTS plan_started_at`,
    );
  }
}
