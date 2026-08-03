import { MigrationInterface, QueryRunner } from 'typeorm';

// Control-plane table — lives in `public`, never a `search_path` target.
// Backs the Paystack/Flutterwave checkout flow (docs/MULTI_TENANT_MIGRATION.md
// §9 Phase 3) — see src/billing/entity/billing-checkout-session.entity.ts for
// why the primary key is the provider's own reference/session id rather than
// a separate generated uuid.
export class AddBillingCheckoutSessions1790899200000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS billing_checkout_sessions (
        id               VARCHAR PRIMARY KEY,
        tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        type             VARCHAR NOT NULL,
        plan_id          VARCHAR,
        credits_amount   INT,
        amount_cents     INT NOT NULL,
        currency         VARCHAR NOT NULL DEFAULT 'NGN',
        provider         VARCHAR NOT NULL,
        status           VARCHAR NOT NULL DEFAULT 'pending',
        completed_at     TIMESTAMPTZ,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_billing_checkout_sessions_tenant ON billing_checkout_sessions(tenant_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS billing_checkout_sessions`);
  }
}
