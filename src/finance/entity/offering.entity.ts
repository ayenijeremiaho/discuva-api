import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { OfferingType } from '../enum/finance.enum';
import { Fund } from './fund.entity';
import { Admin } from '../../admin/entity/admin.entity';

@Entity('finance_offerings')
export class Offering extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true, name: 'service_event_id' })
  serviceEventId: string | null;

  @Index('IDX_offerings_fund_id')
  @ManyToOne(() => Fund, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fund_id' })
  fund: Fund;

  @Column({ type: 'varchar' })
  type: OfferingType;

  @Column({
    type: 'numeric',
    precision: 15,
    scale: 2,
    default: 0,
    name: 'cash_amount',
  })
  cashAmount: number;

  @Column({
    type: 'numeric',
    precision: 15,
    scale: 2,
    default: 0,
    name: 'expected_transfer_amount',
  })
  expectedTransferAmount: number;

  @Column({ type: 'boolean', default: false, name: 'is_reconciled' })
  isReconciled: boolean;

  @Column({ type: 'timestamptz', nullable: true, name: 'reconciled_at' })
  reconciledAt: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @ManyToOne(() => Admin, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'recorded_by_id' })
  recordedBy: Admin;

  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reconciled_by_id' })
  reconciledBy: Admin | null;
}
