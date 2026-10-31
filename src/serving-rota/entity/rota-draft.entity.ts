import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Department } from '../../department/entity/department.entity';
import { Member } from '../../member/entity/member.entity';

// A rota still being worked on. Nobody is told anything until it's published.
@Entity({ name: 'rota_drafts' })
export class RotaDraft extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Department, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'department_id' })
  department: Department;

  @Column({ name: 'service_slot_id', type: 'uuid', nullable: true })
  slotId: string | null;

  @Column({ name: 'schedule_id', type: 'uuid', nullable: true })
  scheduleId: string | null;

  @Column({ name: 'occurrence_date', type: 'date', nullable: true })
  date: string | null;

  @Column({ type: 'jsonb', default: [] })
  entries: { memberId: string; role?: string | null }[];

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by_id' })
  updatedBy: Member | null;
}
