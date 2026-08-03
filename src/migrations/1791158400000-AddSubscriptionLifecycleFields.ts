import { MigrationInterface, QueryRunner } from 'typeorm';

// Control-plane changes — `subscriptions` and `tenant_branch_invites` both
// live in `public`, never a `search_path` target.
//
// subscriptions.cancel_at_period_end: set by CheckoutService.cancelSubscription
// when a tenant self-cancels mid-period — they keep Pro access until
// current_period_end, then SubscriptionLapseScheduler downgrades them,
// rather than losing access immediately on a period they already paid for.
//
// subscriptions.sponsored_by_tenant_id: set when a branch's plan was
// comped by its parent tenant at invite time (BranchInviteService's
// sponsorPlan option) rather than paid for independently — excluded from
// MRR (PlatformAnalyticsService.mrrCents()) since no real money backs it.
//
// tenant_branch_invites.sponsor_plan: the parent's stated intent at
// invite-creation time, carried through to provisioning.
export class AddSubscriptionLifecycleFields1791158400000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE subscriptions
      ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS sponsored_by_tenant_id UUID NULL REFERENCES tenants(id) ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE tenant_branch_invites
      ADD COLUMN IF NOT EXISTS sponsor_plan BOOLEAN NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenant_branch_invites DROP COLUMN IF EXISTS sponsor_plan
    `);
    await queryRunner.query(`
      ALTER TABLE subscriptions
      DROP COLUMN IF EXISTS cancel_at_period_end,
      DROP COLUMN IF EXISTS sponsored_by_tenant_id
    `);
  }
}
