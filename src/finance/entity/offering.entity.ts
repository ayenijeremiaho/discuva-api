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
import { GivingOption } from './giving-option.entity';
import { Member } from '../../member/entity/member.entity';

@Entity('finance_offerings')
export class Offering extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true, name: 'service_event_id' })
  serviceEventId: string | null;

  // Nullable now that a fund can be derived from `givingOption.fund` — see
  // OfferingService.create, which still requires one or the other resolve.
  @Index('IDX_offerings_fund_id')
  @ManyToOne(() => Fund, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'fund_id' })
  fund: Fund | null;

  // Legacy fixed-enum purpose, kept read-only for historical rows created
  // before GivingOption unification — never written to by new entries.
  @Column({ type: 'varchar', nullable: true })
  type: OfferingType | null;

  @Index('IDX_offerings_giving_option_id')
  @ManyToOne(() => GivingOption, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'giving_option_id' })
  givingOption: GivingOption | null;

  // Who physically brought this giving (e.g. cash tithe handed in at
  // church) — null for anonymous/basket collections, which are a
  // legitimate, common case, not a data-entry gap.
  @Index('IDX_offerings_member_id')
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'member_id' })
  member: Member | null;

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
