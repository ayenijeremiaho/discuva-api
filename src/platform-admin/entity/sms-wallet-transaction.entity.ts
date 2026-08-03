import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum SmsWalletTransactionType {
  DEBIT = 'debit',
  CREDIT = 'credit',
}

// Control-plane table — lives in `public`, never a `search_path` target.
// Append-only ledger backing SmsWallet.balanceCredits — every debit/credit
// gets a row here as an audit trail (§4.12). Table already existed from
// src/migrations/1790640000000-AddPlatformControlPlaneTables.ts; this is
// its first TypeORM entity.
@Entity({ name: 'sms_wallet_transactions' })
export class SmsWalletTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  tenantId: string;

  @Column({ type: 'varchar' })
  type: SmsWalletTransactionType;

  // Always a positive magnitude — `type` alone carries direction, so this
  // never needs to also be sign-encoded (no risk of the two disagreeing).
  // `balanceAfter` below is the authoritative running balance, stored
  // directly per row rather than something callers reconstruct by summing.
  @Column()
  credits: number;

  @Column()
  balanceAfter: number;

  @Column({ nullable: true })
  billingProviderPaymentId: string | null;

  @Column({ nullable: true })
  reference: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
