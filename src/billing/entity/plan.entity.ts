import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// Control-plane table — lives in `public`, never a `search_path` target.
// Price and tier count are data, not code: `id` is free-form and `features`
// is an array, so adding a third tier is a row insert (docs/MULTI_TENANT_MIGRATION.md §4.11).
@Entity({ name: 'plans' })
export class Plan {
  @PrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column({ default: 0 })
  priceCents: number;

  @Column({ default: 'NGN' })
  currency: string;

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
