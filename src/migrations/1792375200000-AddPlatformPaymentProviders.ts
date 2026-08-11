import { MigrationInterface, QueryRunner } from 'typeorm';

// Control-plane table — lives in `public`, never a `search_path` target.
// PaymentProviderRegistryService's three registered vendors (paystack,
// flutterwave, kora) previously had no database row at all — just the
// in-memory Map built at boot. This gives platform admins the same
// list/deactivate capability already built for communication and giving
// providers (see docs/TECH_DOC.md's "Payment Providers" subsection). No
// per-tenant config table here, unlike those two — every tenant shares the
// platform's own subscription-billing credentials, so a single global
// isActive flag per provider is all that's needed.
export class AddPlatformPaymentProviders1792375200000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS payment_providers (
        id        VARCHAR PRIMARY KEY,
        name      VARCHAR NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true
      )
    `);

    await queryRunner.query(`
      INSERT INTO payment_providers (id, name) VALUES
        ('paystack', 'Paystack'),
        ('flutterwave', 'Flutterwave'),
        ('kora', 'Korapay')
      ON CONFLICT (id) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS payment_providers`);
  }
}
