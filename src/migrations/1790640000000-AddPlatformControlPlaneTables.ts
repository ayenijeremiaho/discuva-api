import { MigrationInterface, QueryRunner } from 'typeorm';

// Platform control-plane tables for the multi-tenant/freemium SaaS migration
// (see docs/MULTI_TENANT_MIGRATION.md §4.1, §4.11, §4.12). These are
// deliberately NOT tenant data — no relation here is ever a `search_path`
// target. They sit in the same schema as today's single-tenant business
// data for now; §4.1's sequencing note covers why that's fine short-term.
export class AddPlatformControlPlaneTables1790640000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS tenants (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                subdomain   VARCHAR NOT NULL UNIQUE,
                schema_name VARCHAR NOT NULL UNIQUE,
                cluster_id  VARCHAR NOT NULL DEFAULT 'default',
                name        VARCHAR NOT NULL,
                logo_url    VARCHAR,
                currency    VARCHAR NOT NULL DEFAULT 'NGN',
                timezone    VARCHAR NOT NULL DEFAULT 'UTC',
                is_active   BOOLEAN NOT NULL DEFAULT true,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS platform_admins (
                id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                email         VARCHAR NOT NULL UNIQUE,
                password_hash VARCHAR NOT NULL,
                is_active     BOOLEAN NOT NULL DEFAULT true,
                created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS plans (
                id                        VARCHAR PRIMARY KEY,
                name                      VARCHAR NOT NULL,
                price_cents               INT NOT NULL DEFAULT 0,
                currency                  VARCHAR NOT NULL DEFAULT 'NGN',
                billing_provider_price_id VARCHAR,
                features                  TEXT[] NOT NULL DEFAULT '{}',
                created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS subscriptions (
                id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id                         UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
                plan_id                           VARCHAR NOT NULL REFERENCES plans(id),
                status                            VARCHAR NOT NULL DEFAULT 'active',
                payment_provider                  VARCHAR,
                billing_provider_customer_id      VARCHAR,
                billing_provider_subscription_id  VARCHAR,
                current_period_end                TIMESTAMPTZ,
                created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_id ON subscriptions(plan_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status)`,
    );

    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS communication_providers (
                id        VARCHAR PRIMARY KEY,
                channel   VARCHAR NOT NULL,
                name      VARCHAR NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT true
            )
        `);

    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS tenant_communication_provider_configs (
                id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                provider_id           VARCHAR NOT NULL REFERENCES communication_providers(id),
                credentials_encrypted JSONB NOT NULL,
                sender_identity       VARCHAR,
                is_active             BOOLEAN NOT NULL DEFAULT true,
                created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (tenant_id, provider_id)
            )
        `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tenant_comm_configs_tenant ON tenant_communication_provider_configs(tenant_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tenant_comm_configs_provider ON tenant_communication_provider_configs(provider_id)`,
    );

    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS sms_wallets (
                tenant_id       UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
                balance_credits INT NOT NULL DEFAULT 0,
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS sms_wallet_transactions (
                id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id                    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                type                         VARCHAR NOT NULL,
                credits                      INT NOT NULL,
                balance_after                INT NOT NULL,
                billing_provider_payment_id  VARCHAR,
                reference                    VARCHAR,
                created_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_sms_wallet_txns_tenant ON sms_wallet_transactions(tenant_id)`,
    );

    // Seed the launch plan set — free tier plus the not-yet-priced Pro tier
    // (see docs/PRODUCT_STRATEGY.md §5 on why price_cents is 0 for both
    // right now, not just for free).
    await queryRunner.query(`
      INSERT INTO plans (id, name, price_cents, currency, features) VALUES
        ('free', 'Free', 0, 'NGN', '{}'),
        ('pro', 'Pro', 0, 'NGN', ARRAY[
          'finance', 'sms', 'facility_rental', 'games', 'volunteer',
          'asset_management', 'incident_report', 'audit',
          'service_programme', 'service_rating', 'sermon', 'bulk_export'
        ])
      ON CONFLICT (id) DO NOTHING
    `);

    // Seed the launch communication providers — the ones with a concrete
    // implementation today (Termii, Gmail, Resend). Adding another later is
    // a row insert, not a migration (docs §4.12).
    await queryRunner.query(`
      INSERT INTO communication_providers (id, channel, name) VALUES
        ('termii', 'sms', 'Termii'),
        ('gmail', 'email', 'Gmail'),
        ('resend', 'email', 'Resend')
      ON CONFLICT (id) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS sms_wallet_transactions`);
    await queryRunner.query(`DROP TABLE IF EXISTS sms_wallets`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS tenant_communication_provider_configs`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS communication_providers`);
    await queryRunner.query(`DROP TABLE IF EXISTS subscriptions`);
    await queryRunner.query(`DROP TABLE IF EXISTS plans`);
    await queryRunner.query(`DROP TABLE IF EXISTS platform_admins`);
    await queryRunner.query(`DROP TABLE IF EXISTS tenants`);
  }
}
