import { MigrationInterface, QueryRunner } from 'typeorm';

// Control-plane changes — all tables/columns touched here live in `public`,
// never a `search_path` target.
//
// Pivots SMS off the platform-run prepaid wallet entirely: every tenant now
// brings their own SMS provider credentials (pure BYOK), no platform
// fallback. This removes the only writer/reader of sms_wallets and
// sms_wallet_transactions (SmsCredentialResolverService.debitForSend and
// CheckoutService's wallet-topup checkout, both deleted in this pass) and
// billing_checkout_sessions.credits_amount (only ever set for a
// WALLET_TOPUP session, a type that no longer exists) — no code path writes
// to any of these anymore, so this drops them rather than leaving dead
// columns/tables around.
//
// Also seeds the two Twilio-family provider catalog rows: `twilio` for SMS
// (Twilio's Programmable SMS API, its own accountSid/authToken/fromNumber
// credentials) and `sendgrid` for email (Twilio's actual email product,
// SendGrid — a separately-credentialed API, apiKey only). SendGridProvider
// itself already existed in code (src/utility/email-provider/) but was
// never seeded into the catalog, so no tenant could actually select it.
export class RemoveSmsWalletAndSeedTwilioProviders1792022400000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS sms_wallet_transactions`);
    await queryRunner.query(`DROP TABLE IF EXISTS sms_wallets`);
    await queryRunner.query(`
      ALTER TABLE billing_checkout_sessions
      DROP COLUMN IF EXISTS credits_amount
    `);

    await queryRunner.query(`
      INSERT INTO communication_providers (id, channel, name) VALUES
        ('twilio', 'sms', 'Twilio'),
        ('sendgrid', 'email', 'SendGrid (Twilio)')
      ON CONFLICT (id) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM communication_providers WHERE id IN ('twilio', 'sendgrid')
    `);

    await queryRunner.query(`
      ALTER TABLE billing_checkout_sessions
      ADD COLUMN IF NOT EXISTS credits_amount INT
    `);

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
  }
}
