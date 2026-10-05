import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { ServiceProgramme } from './service-programme.entity';
import { ServiceSlotTypeEnum } from '../enum/service-slot-type.enum';

export interface TemplateProgrammeSlot {
  position: number;
  type: ServiceSlotTypeEnum;
  topic: string | null;
  allocatedMinutes: number;
  // Teams are stable week to week, so templates keep them; individual people are not kept.
  departmentId?: string | null;
}

@Entity({ name: 'service_programme_templates' })
export class ServiceProgrammeTemplate extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ name: 'service_slot_name' })
  serviceSlotName: string;

  @Column({ type: 'jsonb', default: [] })
  slots: TemplateProgrammeSlot[];

  @ManyToOne(() => ServiceProgramme, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_from_id' })
  createdFrom: ServiceProgramme | null;
}
