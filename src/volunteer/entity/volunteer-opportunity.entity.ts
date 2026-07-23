import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Department } from '../../department/entity/department.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { VolunteerOpportunityStatusEnum } from '../enum/volunteer-opportunity-status.enum';

@Entity({ name: 'volunteer_opportunities' })
export class VolunteerOpportunity extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // Categorization/reporting only, not access control — mirrors Game.department.
  @ManyToOne(() => Department, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'department_id' })
  department: Department | null;

  @Index()
  @Column({ type: 'timestamptz' })
  date: Date;

  @Column({ type: 'int', nullable: true })
  capacity: number | null;

  // Denormalized count of CONFIRMED signups, maintained inside the same locked
  // transaction as signup/cancel — avoids a COUNT(*) query per capacity check
  // and matches PrayerMeeting.currentCapacity's precedent in this codebase.
  @Column({ type: 'int', default: 0 })
  confirmedCount: number;

  @Column({
    type: 'varchar',
    default: VolunteerOpportunityStatusEnum.OPEN,
  })
  status: VolunteerOpportunityStatusEnum;

  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: Admin | null;
}
