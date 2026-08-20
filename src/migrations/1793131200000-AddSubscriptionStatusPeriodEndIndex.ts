import { MigrationInterface, QueryRunner } from 'typeorm';

// SubscriptionLapseScheduler runs daily against this platform-wide table
// with `WHERE status = 'active' AND current_period_end < now()` — the
// existing idx_subscriptions_status index barely narrows that scan since
// ACTIVE is the majority status. A composite (status, current_period_end)
// index serves that query directly, and its leftmost prefix also covers
// any plain status-only filter, so the old single-column index becomes
// redundant — dropped here rather than left as unnecessary write overhead.
export class AddSubscriptionStatusPeriodEndIndex1793131200000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_subscriptions_status_current_period_end
       ON subscriptions(status, current_period_end)`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_subscriptions_status`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status)`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_subscriptions_status_current_period_end`,
    );
  }
}
