import { MigrationInterface, QueryRunner } from 'typeorm';

// Control-plane — `public`, never a `search_path` target.
// PlatformAnalyticsService.getGiving() runs four queries against
// giving_checkout_sessions, every one of them `WHERE status = 'completed'`
// and one also `ORDER BY completed_at` (the trend-bucketing fetch) — the
// original AddGivingCheckout migration only indexed tenant_id/member_id,
// missing the columns every analytics read actually filters/sorts on.
// A single composite index covers both shapes: the WHERE-only queries use
// its leftmost column, the ORDER BY query uses the full pair.
export class AddGivingCheckoutSessionStatusIndex1792281600000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_giving_checkout_sessions_status_completed_at ON giving_checkout_sessions(status, completed_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_giving_checkout_sessions_status_completed_at`,
    );
  }
}
