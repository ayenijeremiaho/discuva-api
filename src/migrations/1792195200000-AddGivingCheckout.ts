import { MigrationInterface, QueryRunner } from 'typeorm';

// Control-plane tables — live in `public`, never a `search_path` target.
// Tenant-owned checkout for tithes/offerings (§9 Phase 9h): a church brings
// its own Paystack/Flutterwave/Kora/Stripe credentials (BYOK, same shape as
// tenant_communication_provider_configs) so members pay the church
// directly via a hosted checkout page, rather than the deleted
// virtual-account scaffold. giving_checkout_sessions mirrors
// billing_checkout_sessions: recorded at checkout-initiation time, primary
// keyed by the provider's own reference — the only thing a webhook payload
// is ever trusted for identity/amount against. All three tables must be
// resolvable with no tenant (schema) context at all, since the inbound
// provider webhook has no Host header/subdomain, only the :tenantId path
// param — GivingCheckoutService looks these up directly, then manually
// enters the resolved tenant's own schema only to write the resulting
// TitheRecord.
export class AddGivingCheckout1792195200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS giving_providers (
        id        VARCHAR PRIMARY KEY,
        name      VARCHAR NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS tenant_giving_provider_configs (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        provider_id           VARCHAR NOT NULL REFERENCES giving_providers(id),
        credentials_encrypted JSONB NOT NULL,
        is_active             BOOLEAN NOT NULL DEFAULT true,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, provider_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tenant_giving_configs_tenant ON tenant_giving_provider_configs(tenant_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS giving_checkout_sessions (
        id               VARCHAR PRIMARY KEY,
        tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        member_id        UUID NOT NULL,
        tithe_account_id UUID,
        amount_cents     INT NOT NULL,
        currency         VARCHAR NOT NULL,
        provider         VARCHAR NOT NULL,
        status           VARCHAR NOT NULL DEFAULT 'pending',
        completed_at     TIMESTAMPTZ,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_giving_checkout_sessions_tenant ON giving_checkout_sessions(tenant_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_giving_checkout_sessions_member ON giving_checkout_sessions(member_id)`,
    );

    // Launch vendor set — a row insert (not a migration) is all a fifth
    // vendor needs later, per GivingProviderRegistryService's own comment.
    await queryRunner.query(`
      INSERT INTO giving_providers (id, name) VALUES
        ('paystack', 'Paystack'),
        ('flutterwave', 'Flutterwave'),
        ('kora', 'Korapay'),
        ('stripe', 'Stripe')
      ON CONFLICT (id) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS giving_checkout_sessions`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS tenant_giving_provider_configs`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS giving_providers`);
  }
}
