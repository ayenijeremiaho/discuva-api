import { MigrationInterface, QueryRunner } from 'typeorm';

// Control-plane change — `subscriptions` lives in `public`, never a
// `search_path` target. Needed for accurate churn analytics
// (GET /platform/analytics/churn): `updatedAt` changes on ANY field update,
// not just a cancellation, so it can't be trusted as "when this subscription
// was canceled" — a dedicated nullable timestamp, set exactly once by
// CheckoutService.applySubscriptionCanceled, is the only reliable source.
export class AddSubscriptionCanceledAt1791072000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE subscriptions
      ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE subscriptions DROP COLUMN IF EXISTS canceled_at
    `);
  }
}
