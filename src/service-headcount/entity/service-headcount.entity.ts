import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { Admin } from '../../admin/entity/admin.entity';

@Entity({ name: 'service_headcounts' })
export class ServiceHeadcount extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => ServiceSlot, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_slot_id' })
  serviceSlot: ServiceSlot;

  @Column({ name: 'male_adults', default: 0 })
  maleAdults: number;

  @Column({ name: 'female_adults', default: 0 })
  femaleAdults: number;

  @Column({ default: 0 })
  teenagers: number;

  @Column({ default: 0 })
  children: number;

  @Column({ name: 'mobile_church', default: 0 })
  mobileChurch: number;

  @Column({ name: 'custom_groups', type: 'jsonb', default: {} })
  customGroups: Record<string, number>;

  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'recorded_by_id' })
  recordedBy: Admin | null;

  @Column({ nullable: true, type: 'text' })
  notes: string | null;
}
