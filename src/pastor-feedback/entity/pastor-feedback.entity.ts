import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Department } from '../../department/entity/department.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { Pastor } from '../../member/entity/pastor.entity';
import { BaseEntity } from '../../utility/entity/base.entity';

@Entity({ name: 'pastor_feedback' })
@Unique(['department', 'weekOf'])
export class PastorFeedback extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Department, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'department_id' })
  department: Department;

  // Nullable + SET NULL (not RESTRICT) — a revoked worker's old feedback
  // shouldn't block their WorkerProfile from being deleted. Name is
  // snapshotted below so history survives regardless of the live FK.
  @ManyToOne(() => WorkerProfile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'submitted_by_id' })
  submittedBy: WorkerProfile | null;

  @Column({ name: 'submitted_by_name' })
  submittedByName: string;

  @Index()
  @Column({ name: 'week_of', type: 'date' })
  weekOf: string;

  @Column({ name: 'attendance_notes', type: 'text' })
  attendanceNotes: string;

  @Column({ type: 'text' })
  highlights: string;

  @Column({ type: 'text' })
  challenges: string;

  @Column({ name: 'prayer_requests', type: 'text', nullable: true })
  prayerRequests: string | null;

  @Column({ name: 'additional_notes', type: 'text', nullable: true })
  additionalNotes: string | null;

  @Column({
    name: 'submitted_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  submittedAt: Date;

  @ManyToOne(() => Pastor, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'responded_by_pastor_id' })
  respondedByPastor: Pastor | null;

  @Column({ name: 'responded_by_pastor_name', nullable: true })
  respondedByPastorName: string | null;

  @Column({ name: 'pastor_response', type: 'text', nullable: true })
  pastorResponse: string | null;

  @Column({
    name: 'pastor_responded_at',
    type: 'timestamptz',
    nullable: true,
  })
  pastorRespondedAt: Date | null;
}
