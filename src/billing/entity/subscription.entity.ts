import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { SubscriptionStatus } from '../enum/subscription-status.enum';

// Control-plane table — lives in `public`, never a `search_path` target.
// One row per tenant (tenantId is unique): upgrade/downgrade is a planId
// change on the existing row, never a new one. A free-tier tenant still
// gets a row (planId = 'free', paymentProvider = null) so "which plan is
// this tenant on" is always one query, no null-tenant special case
// (docs/MULTI_TENANT_MIGRATION.md §4.11). Plain FK scalars, not relations —
// nothing here needs to load a joined Tenant/Plan, just filter by id.
@Entity({ name: 'subscriptions' })
export class Subscription extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  tenantId: string;

  @Column()
  planId: string;

  @Column({ default: SubscriptionStatus.ACTIVE })
  status: SubscriptionStatus;

  @Column({ nullable: true })
  paymentProvider: string | null;

  @Column({ nullable: true })
  billingProviderCustomerId: string | null;

  @Column({ nullable: true })
  billingProviderSubscriptionId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  currentPeriodEnd: Date | null;

  // Set exactly once, by CheckoutService.applySubscriptionCanceled — see
  // the migration comment for why this can't just be `updatedAt`.
  @Column({ type: 'timestamptz', nullable: true })
  canceledAt: Date | null;

  // Set by CheckoutService.cancelSubscription() when a tenant self-cancels
  // mid-period — SubscriptionLapseScheduler downgrades them once
  // currentPeriodEnd passes rather than immediately, so they keep the
  // access they already paid for.
  @Column({ default: false })
  cancelAtPeriodEnd: boolean;

  // Set when this tenant's plan was comped by a parent tenant at branch
  // invite time (BranchInviteService's sponsorPlan option) rather than
  // paid for independently. Excluded from PlatformAnalyticsService's MRR
  // calculation — no real money backs a sponsored subscription.
  @Column({ nullable: true })
  sponsoredByTenantId: string | null;
}
