import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum DiscuvaAccountCodePurpose {
  JOIN = 'JOIN',
  LINK = 'LINK',
  RECOVER = 'RECOVER',
  FREEZE = 'FREEZE',
  EMAIL_UNDO = 'EMAIL_UNDO',
}

// Emailed 6-digit codes for joining, linking and recovery; only the hash is kept.
@Entity({ name: 'discuva_account_codes' })
@Index('IDX_discuva_account_codes_open', ['email', 'purpose', 'deviceId'], {
  where: 'used_at IS NULL',
})
@Index('IDX_discuva_account_codes_link_token', ['codeHash'], {
  where: 'used_at IS NULL AND account_id IS NOT NULL',
})
export class DiscuvaAccountCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  email: string;

  @Column({ type: 'varchar', length: 16 })
  purpose: DiscuvaAccountCodePurpose;

  @Column()
  codeHash: string;

  @Column({ type: 'varchar', nullable: true })
  deviceId: string | null;

  @Column({ type: 'uuid', nullable: true })
  tenantId: string | null;

  // Set for freeze and email-undo links, which act on one account.
  @Column({ type: 'uuid', nullable: true })
  accountId: string | null;

  @Index('IDX_discuva_account_codes_expires_at')
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
