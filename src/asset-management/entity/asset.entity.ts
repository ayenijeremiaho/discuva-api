import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { AssetStatus } from '../enum/asset.enum';
import { MaintenanceSchedule } from './maintenance-schedule.entity';
import { MaintenanceRecord } from './maintenance-record.entity';
import { AssetCheckout } from './asset-checkout.entity';
import { Department } from '../../department/entity/department.entity';

@Entity('assets')
export class Asset extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true, name: 'tag_number' })
  tagNumber: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar' })
  category: string;

  @Column({ type: 'varchar', nullable: true })
  location: string | null;

  @Column({ type: 'varchar', default: AssetStatus.ACTIVE })
  status: AssetStatus;

  @Column({ type: 'varchar', nullable: true, name: 'serial_number' })
  serialNumber: string | null;

  @Column({ type: 'varchar', nullable: true })
  manufacturer: string | null;

  @Column({ type: 'varchar', nullable: true })
  model: string | null;

  @Column({ type: 'date', nullable: true, name: 'purchase_date' })
  purchaseDate: string | null;

  @Column({
    type: 'decimal',
    precision: 15,
    scale: 2,
    nullable: true,
    name: 'purchase_value',
  })
  purchaseValue: number | null;

  @Column({ type: 'date', nullable: true, name: 'warranty_expiry' })
  warrantyExpiry: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'vendor_name' })
  vendorName: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'vendor_contact' })
  vendorContact: string | null;

  @ManyToOne(() => Department, {
    nullable: true,
    onDelete: 'SET NULL',
    eager: false,
  })
  @JoinColumn({ name: 'department_id' })
  department: Department | null;

  @Column({ type: 'boolean', default: false, name: 'maintenance_enabled' })
  maintenanceEnabled: boolean;

  @Column({ type: 'boolean', default: false, name: 'inventory_enabled' })
  inventoryEnabled: boolean;

  @Column({ type: 'int', nullable: true, name: 'in_storage' })
  inStorage: number | null;

  @Column({ type: 'int', nullable: true, name: 'in_use' })
  inUse: number | null;

  @Column({ type: 'int', nullable: true, name: 'under_repair' })
  underRepair: number | null;

  @Column({ type: 'int', nullable: true, name: 'written_off' })
  writtenOff: number | null;

  // The 12 warranty/insurance/roadworthiness "notifiedNDaysAt" columns below
  // are superseded by the 3 jsonb threshold-list columns further down
  // (tenant-configurable thresholds, not just 30/14/7/1) — left in place,
  // unused, rather than dropped on this pre-existing, real-data table. See
  // AddAssetExpiryNotifiedThresholds migration.
  @Column({
    type: 'timestamptz',
    nullable: true,
    name: 'warranty_notified_30_days_at',
  })
  warrantyNotified30DaysAt: Date | null;

  @Column({
    type: 'timestamptz',
    nullable: true,
    name: 'warranty_notified_14_days_at',
  })
  warrantyNotified14DaysAt: Date | null;

  @Column({
    type: 'timestamptz',
    nullable: true,
    name: 'warranty_notified_7_days_at',
  })
  warrantyNotified7DaysAt: Date | null;

  @Column({
    type: 'timestamptz',
    nullable: true,
    name: 'warranty_notified_1_day_at',
  })
  warrantyNotified1DayAt: Date | null;

  @Column({ type: 'date', nullable: true, name: 'insurance_expiry' })
  insuranceExpiry: string | null;

  @Column({
    type: 'timestamptz',
    nullable: true,
    name: 'insurance_notified_30_days_at',
  })
  insuranceNotified30DaysAt: Date | null;

  @Column({
    type: 'timestamptz',
    nullable: true,
    name: 'insurance_notified_14_days_at',
  })
  insuranceNotified14DaysAt: Date | null;

  @Column({
    type: 'timestamptz',
    nullable: true,
    name: 'insurance_notified_7_days_at',
  })
  insuranceNotified7DaysAt: Date | null;

  @Column({
    type: 'timestamptz',
    nullable: true,
    name: 'insurance_notified_1_day_at',
  })
  insuranceNotified1DayAt: Date | null;

  @Column({ type: 'date', nullable: true, name: 'roadworthiness_expiry' })
  roadworthinessExpiry: string | null;

  @Column({
    type: 'timestamptz',
    nullable: true,
    name: 'roadworthiness_notified_30_days_at',
  })
  roadworthinessNotified30DaysAt: Date | null;

  @Column({
    type: 'timestamptz',
    nullable: true,
    name: 'roadworthiness_notified_14_days_at',
  })
  roadworthinessNotified14DaysAt: Date | null;

  @Column({
    type: 'timestamptz',
    nullable: true,
    name: 'roadworthiness_notified_7_days_at',
  })
  roadworthinessNotified7DaysAt: Date | null;

  @Column({
    type: 'timestamptz',
    nullable: true,
    name: 'roadworthiness_notified_1_day_at',
  })
  roadworthinessNotified1DayAt: Date | null;

  @Column({
    type: 'jsonb',
    name: 'warranty_notified_thresholds',
    default: () => "'[]'",
  })
  warrantyNotifiedThresholds: number[];

  @Column({
    type: 'jsonb',
    name: 'insurance_notified_thresholds',
    default: () => "'[]'",
  })
  insuranceNotifiedThresholds: number[];

  @Column({
    type: 'jsonb',
    name: 'roadworthiness_notified_thresholds',
    default: () => "'[]'",
  })
  roadworthinessNotifiedThresholds: number[];

  @OneToOne(() => MaintenanceSchedule, (schedule) => schedule.asset, {
    cascade: true,
    nullable: true,
  })
  maintenanceSchedule: MaintenanceSchedule | null;

  @OneToMany(() => MaintenanceRecord, (record) => record.asset)
  maintenanceRecords: MaintenanceRecord[];

  @OneToMany(() => AssetCheckout, (checkout) => checkout.asset)
  checkouts: AssetCheckout[];
}
