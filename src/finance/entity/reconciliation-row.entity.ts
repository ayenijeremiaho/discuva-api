import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { ReconciliationRowStatus } from '../enum/finance.enum';
import { BulkUploadJob } from './bulk-upload-job.entity';
import { Account } from './account.entity';

@Entity('finance_reconciliation_rows')
export class ReconciliationRow extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_reconciliation_rows_job_id')
  @ManyToOne(() => BulkUploadJob, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_id' })
  job: BulkUploadJob;

  @Column({ type: 'varchar', name: 'row_fingerprint' })
  rowFingerprint: string;

  @Column({ type: 'varchar', name: 'transaction_fingerprint' })
  transactionFingerprint: string;

  @Column({ type: 'date', name: 'transaction_date' })
  transactionDate: string;

  @Column({ type: 'varchar', nullable: true })
  narration: string | null;

  @Column({ type: 'numeric', precision: 15, scale: 2 })
  amount: number;

  @Column({ type: 'varchar', name: 'credit_debit' })
  creditDebit: string;

  @Column({ type: 'varchar', default: ReconciliationRowStatus.PENDING })
  status: ReconciliationRowStatus;

  @ManyToOne(() => Account, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'suggested_account_id' })
  suggestedAccount: Account | null;

  @ManyToOne(() => Account, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'confirmed_account_id' })
  confirmedAccount: Account | null;

  @Column({ type: 'text', nullable: true, name: 'match_note' })
  matchNote: string | null;
}
