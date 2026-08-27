import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';
import { Department } from '../../department/entity/department.entity';
import { FinanceCategory } from './finance-category.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { FinanceRequestStatus } from '../enum/finance-request.enum';
import { JournalEntry } from '../../finance/entity/journal-entry.entity';

@Entity({ name: 'finance_requests' })
export class FinanceRequest extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'requested_by' })
  requestedBy: Member;

  @ManyToOne(() => Department, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'department_id' })
  department: Department;

  @ManyToOne(() => FinanceCategory, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'category_id' })
  category: FinanceCategory;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: number;

  @Column({ type: 'character varying' })
  recipientBankName: string;

  @Column({ type: 'character varying' })
  recipientAccountNumber: string;

  @Column({ type: 'character varying' })
  recipientAccountName: string;

  @Column({ type: 'character varying', nullable: true })
  attachmentUrl: string;

  @Column({ type: 'character varying', nullable: true })
  attachmentPublicId: string;

  @Column({ type: 'character varying', nullable: true })
  attachmentResourceType: string;

  @Column({ type: 'character varying', default: FinanceRequestStatus.PENDING })
  status: FinanceRequestStatus;

  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewed_by' })
  reviewedBy: Admin;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date;

  @Column({ type: 'text', nullable: true })
  rejectionReason: string;

  @Column({ type: 'character varying', nullable: true })
  proofUrl: string;

  @Column({ type: 'character varying', nullable: true })
  proofPublicId: string;

  @Column({ type: 'character varying', nullable: true })
  proofResourceType: string;

  // Set when a finance-team admin opts to post this request's payment to
  // the ledger at proof-attachment time — see FinanceRequestService.
  // Nullable/SET NULL: a voided or deleted journal entry shouldn't take the
  // finance request down with it.
  @ManyToOne(() => JournalEntry, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'journal_entry_id' })
  journalEntry: JournalEntry | null;
}
