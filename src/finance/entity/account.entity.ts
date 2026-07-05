import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import {
  AccountSubtype,
  AccountType,
  NormalBalance,
} from '../enum/finance.enum';
import { Fund } from './fund.entity';

@Entity('finance_accounts')
export class Account extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', nullable: true, unique: true })
  code: string | null;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar' })
  type: AccountType;

  @Column({ type: 'varchar' })
  subtype: AccountSubtype;

  @Column({ type: 'varchar', name: 'normal_balance' })
  normalBalance: NormalBalance;

  @ManyToOne(() => Fund, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'fund_id' })
  fund: Fund | null;

  @Column({
    type: 'numeric',
    precision: 15,
    scale: 2,
    default: 0,
    name: 'current_balance',
  })
  currentBalance: number;

  @Column({
    type: 'numeric',
    precision: 15,
    scale: 2,
    nullable: true,
    name: 'low_balance_alert_threshold',
  })
  lowBalanceAlertThreshold: number | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'bank_name' })
  bankName: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'account_number' })
  accountNumber: string | null;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;
}
