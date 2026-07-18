import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { PledgeContributionStatus } from '../enum/finance.enum';
import { Pledge } from './pledge.entity';
import { Member } from '../../member/entity/member.entity';
import { Admin } from '../../admin/entity/admin.entity';

@Entity('finance_pledge_contributions')
export class PledgeContribution extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Pledge, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pledge_id' })
  pledge: Pledge;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'submitted_by_id' })
  submittedBy: Member;

  @Column({ type: 'numeric', precision: 15, scale: 2 })
  amount: number;

  @Column({ type: 'date', name: 'payment_date' })
  paymentDate: string;

  @Column({ type: 'varchar', nullable: true })
  reference: string | null;

  @Column({ type: 'varchar', default: PledgeContributionStatus.PENDING })
  status: PledgeContributionStatus;

  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewed_by' })
  reviewedBy: Admin | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'reviewed_at' })
  reviewedAt: Date | null;

  @Column({ type: 'varchar', nullable: true, name: 'finance_note' })
  financeNote: string | null;
}
