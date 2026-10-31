import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { ServiceProgrammeStatusEnum } from '../enum/service-programme-status.enum';
import { ServiceProgrammeSlot } from './service-programme-slot.entity';
import { ServiceSession } from './service-session.entity';

@Entity({ name: 'service_programmes' })
export class ServiceProgramme extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @OneToOne(() => ServiceSlot, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_slot_id' })
  serviceSlot: ServiceSlot;

  @Column({ default: ServiceProgrammeStatusEnum.DRAFT })
  status: ServiceProgrammeStatusEnum;

  // Null while it's a draft: nobody is told about a programme until it's published.
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Column({ name: 'save_as_template', default: false })
  saveAsTemplate: boolean;

  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_admin_id' })
  createdByAdmin: Admin | null;

  @OneToMany(() => ServiceProgrammeSlot, (slot) => slot.programme, {
    cascade: true,
  })
  slots: ServiceProgrammeSlot[];

  @OneToOne(() => ServiceSession, (session) => session.programme)
  session: ServiceSession;
}
