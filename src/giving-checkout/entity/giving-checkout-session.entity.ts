import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';

export enum GivingCheckoutStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

// Control-plane table — lives in `public`, never a `search_path` target,
// same reasoning as BillingCheckoutSession: the webhook that resolves this
// has no tenant (schema) context yet, only the provider's own reference and
// the :tenantId path param. Recorded at checkout-initiation time, before the
// member ever reaches the provider's hosted page — the webhook only ever
// confirms/denies a session this row already describes; a forged webhook
// can claim anything, but it can't make GivingCheckoutService create a
// TitheRecord for a session id that was never actually issued, or for a
// different member/amount than what was recorded here.
//
// `memberId`/`titheAccountId`/`givingOptionId`/`pledgeId` are plain UUID
// columns, not FK-enforced relations — Member/TitheAccount/GivingOption/
// Pledge all live in the tenant's own schema, which a public-schema table
// can't foreign-key into. givingOptionId and pledgeId are mutually
// exclusive (validated in GivingCheckoutService.initiateCheckout) — a
// giving-option-designated payment becomes a TitheRecord, a
// pledge-designated one becomes a PledgeContribution instead; the two
// ledgers are deliberately never conflated.
@Entity({ name: 'giving_checkout_sessions' })
export class GivingCheckoutSession extends BaseEntity {
  @PrimaryColumn()
  id: string;

  @Index()
  @Column()
  tenantId: string;

  @Index()
  @Column()
  memberId: string;

  @Column({ nullable: true })
  titheAccountId: string | null;

  @Column({ nullable: true })
  givingOptionId: string | null;

  @Column({ nullable: true })
  pledgeId: string | null;

  @Column()
  amountCents: number;

  @Column()
  currency: string;

  @Column()
  provider: string;

  @Column({ type: 'varchar', default: GivingCheckoutStatus.PENDING })
  status: GivingCheckoutStatus;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
