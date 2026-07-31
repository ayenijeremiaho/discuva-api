import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// Control-plane table — lives in `public`, never a `search_path` target.
// One row per tenant, keyed by tenant_id directly (no separate uuid) —
// platform-managed prepaid SMS credits (§4.12), debited by segment.
@Entity({ name: 'sms_wallets' })
export class SmsWallet {
  @PrimaryColumn()
  tenantId: string;

  @Column({ default: 0 })
  balanceCredits: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
