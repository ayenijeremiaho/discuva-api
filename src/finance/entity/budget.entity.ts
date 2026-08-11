import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { BudgetPeriod } from '../enum/finance.enum';
import { Fund } from './fund.entity';
import { Account } from './account.entity';
import { Admin } from '../../admin/entity/admin.entity';

@Entity('finance_budgets')
export class Budget extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @ManyToOne(() => Fund, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fund_id' })
  fund: Fund;

  @ManyToOne(() => Account, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ type: 'varchar' })
  period: BudgetPeriod;

  @Column({ type: 'numeric', precision: 15, scale: 2 })
  amount: number;

  @Column({ type: 'date', name: 'start_date' })
  startDate: string;

  @Column({ type: 'date', name: 'end_date' })
  endDate: string;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  // Superseded by alertsSent below (tenant-configurable threshold list, not
  // just 80/100) — left in place, unused, rather than dropped on this
  // pre-existing, real-data table. See AddBudgetAlertsSentColumn migration.
  @Column({ type: 'timestamptz', nullable: true, name: 'alert_80_sent_at' })
  alert80SentAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'alert_100_sent_at' })
  alert100SentAt: Date | null;

  @Column({ type: 'jsonb', name: 'alerts_sent', default: () => "'[]'" })
  alertsSent: number[];

  @ManyToOne(() => Admin, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: Admin;
}
