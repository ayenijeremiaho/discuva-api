import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { MaintenanceFrequencyUnit } from '../enum/asset.enum';
import { Asset } from './asset.entity';

@Entity('asset_maintenance_schedules')
export class MaintenanceSchedule extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Asset, (asset) => asset.maintenanceSchedule, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'asset_id' })
  asset: Asset;

  @Column({ type: 'varchar', name: 'frequency_unit' })
  frequencyUnit: MaintenanceFrequencyUnit;

  @Column({ type: 'int', name: 'frequency_value' })
  frequencyValue: number;

  @Column({ type: 'date', nullable: true, name: 'last_maintained_at' })
  lastMaintainedAt: string | null;

  @Column({ type: 'date', name: 'next_due_at' })
  nextDueAt: string;

  // Superseded by notifiedThresholds below (tenant-configurable threshold
  // list, not just 7/3/1/0) — left in place, unused, rather than dropped on
  // this pre-existing, real-data table. See
  // AddMaintenanceNotifiedThresholds migration.
  @Column({ type: 'timestamptz', nullable: true, name: 'notified_7_days_at' })
  notified7DaysAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'notified_3_days_at' })
  notified3DaysAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'notified_1_day_at' })
  notified1DayAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'notified_due_day_at' })
  notifiedDueDayAt: Date | null;

  @Column({ type: 'jsonb', name: 'notified_thresholds', default: () => "'[]'" })
  notifiedThresholds: number[];

  @Column({
    type: 'timestamptz',
    nullable: true,
    name: 'last_overdue_notified_at',
  })
  lastOverdueNotifiedAt: Date | null;
}
