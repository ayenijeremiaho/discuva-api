import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { BillingInterval } from '../enum/billing-interval.enum';

// Control-plane table — lives in `public`, never a `search_path` target.
// Price and tier count are data, not code: `id` is free-form and `features`
// is an array, so adding a third tier is a row insert (docs/MULTI_TENANT_MIGRATION.md §4.11).
// A single row is one immutable priced offering in one currency and one
// billing interval. Multiple rows can represent the same conceptual tier
// across currency and/or interval (e.g. 'pro' NGN/monthly, 'pro-usd'
// USD/monthly, 'pro-annual' NGN/annual) by sharing the same `tierKey` —
// `id` stays the real billing identity (what Subscription.planId points
// to, what billingProviderPriceId is cached against), `tierKey` is purely
// a grouping/display concern, never read by checkout/guard logic.
@Entity({ name: 'plans' })
export class Plan {
  @PrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column()
  tierKey: string;

  @Column({ default: 0 })
  priceCents: number;

  @Column({ default: 'NGN' })
  currency: string;

  @Column({ default: 'monthly' })
  billingInterval: BillingInterval;

  @Column({ nullable: true })
  billingProviderPriceId: string | null;

  @Column('text', { array: true, default: '{}' })
  features: string[];

  // Optional numeric cap layered on top of `features` membership — a
  // feature can be boolean-gated only (absent here) or additionally capped
  // at N lifetime uses per tenant (present here, checked by PlanGuard
  // against FeatureUsage). Keys are PlanFeature values; deliberately a
  // free-form map rather of one column per feature, so a platform admin can
  // cap any current or future feature from the Plan edit UI without a code
  // change or migration.
  @Column({ type: 'jsonb', default: {} })
  featureLimits: Record<string, number>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
