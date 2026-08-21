import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type EmailLogStatus = 'sent' | 'failed';
// 'tenant' = sent via the church's own configured (BYOK) provider.
// 'platform_default' = the church had no provider configured, so Discuva's
// own default provider (EMAIL_PROVIDER env var) sent it instead.
export type EmailLogSource = 'tenant' | 'platform_default';

@Entity('email_logs')
@Index('IDX_email_logs_recipient', ['recipient'])
@Index('IDX_email_logs_status', ['status'])
@Index('IDX_email_logs_createdAt', ['createdAt'])
export class EmailLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  recipient: string;

  @Column({ nullable: true })
  subject: string;

  @Column({ type: 'varchar' })
  status: EmailLogStatus;

  @Column({ nullable: true })
  jobId: string;

  @Column({ nullable: true, type: 'text' })
  errorMessage: string;

  @Column({ nullable: true })
  provider: string;

  // Nullable — rows logged before this column existed have no value; the
  // frontend treats a missing source as "unknown," not as either label.
  @Column({ type: 'varchar', nullable: true })
  source: EmailLogSource | null;

  @Column({ type: 'int', default: 0 })
  attemptsMade: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
