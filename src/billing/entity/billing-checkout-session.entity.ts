import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';

export enum BillingCheckoutType {
  SUBSCRIPTION = 'subscription',
  WALLET_TOPUP = 'wallet_topup',
}

export enum BillingCheckoutStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

// Control-plane table — lives in `public`, never a `search_path` target.
// Recorded at checkout-initiation time, before the tenant ever reaches the
// provider's hosted page — the webhook only ever confirms/denies a session
// this row already describes, it's never the source of truth for amount,
// tenant, or intent (docs/MULTI_TENANT_MIGRATION.md §9 Phase 3): a forged
// webhook can claim anything, but it can't make CheckoutService credit a
// wallet or upgrade a plan for a session id that was never actually issued.
// Primary key IS the provider reference/session id (not a separate uuid +
// a unique index on it) — that's the only value a webhook ever carries to
// look this row up by, so making it the key directly means one indexed
// lookup, not two.
@Entity({ name: 'billing_checkout_sessions' })
export class BillingCheckoutSession extends BaseEntity {
  @PrimaryColumn()
  id: string;

  @Index()
  @Column()
  tenantId: string;

  @Column({ type: 'varchar' })
  type: BillingCheckoutType;

  // Set for type = SUBSCRIPTION only.
  @Column({ nullable: true })
  planId: string | null;

  // Set for type = WALLET_TOPUP only — the SMS credits this session buys,
  // computed once at initiation time from SMS_CREDIT_PRICE_KOBO and
  // credited verbatim on success (never recomputed from the webhook's own
  // amount, for the same never-trust-the-payload reason as the class
  // comment above).
  @Column({ nullable: true })
  creditsAmount: number | null;

  @Column()
  amountCents: number;

  @Column({ default: 'NGN' })
  currency: string;

  @Column()
  provider: string;

  @Column({ type: 'varchar', default: BillingCheckoutStatus.PENDING })
  status: BillingCheckoutStatus;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
