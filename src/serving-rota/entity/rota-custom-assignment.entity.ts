import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';
import { RotaSchedule } from './rota-schedule.entity';
import { RotaResponsibility } from './rota-responsibility.entity';

@Entity({ name: 'rota_custom_assignments' })
@Unique(['schedule', 'date', 'member'])
@Index(['schedule', 'date'])
@Index(['member', 'date'])
export class RotaCustomAssignment extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => RotaSchedule, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schedule_id' })
  schedule: RotaSchedule;

  @Column({ name: 'occurrence_date', type: 'date' })
  date: string;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @ManyToOne(() => RotaResponsibility, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'responsibility_id' })
  responsibility: RotaResponsibility | null;

  @Column({ type: 'varchar', length: 80 })
  role: string;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_by_id' })
  assignedBy: Member | null;
}
