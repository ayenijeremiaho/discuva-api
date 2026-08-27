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
import { Admin } from '../../admin/entity/admin.entity';
import { Assignment } from './assignment.entity';
import { ClassEnrollment } from './class-enrollment.entity';

@Entity({ name: 'assignment_submissions' })
@Unique(['assignment', 'member'])
@Unique(['assignment', 'classEnrollment'])
export class AssignmentSubmission extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Assignment, (a) => a.submissions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assignment_id' })
  assignment: Assignment;

  // Exactly one of member/classEnrollment is set — a submission is made
  // either by an authenticated member or by a specific guest enrollment via
  // the public guest portal (ClassPublicController), never both. Converting
  // a guest to a member later doesn't rewrite past guest-path submissions,
  // only affects new ones going forward.
  @Index()
  @ManyToOne(() => Member, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member | null;

  @Index()
  @ManyToOne(() => ClassEnrollment, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'class_enrollment_id' })
  classEnrollment: ClassEnrollment | null;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  submittedAt: Date;

  @Column({ type: 'int', nullable: true })
  score: number | null;

  @Column({ type: 'text', nullable: true })
  feedback: string | null;

  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'graded_by' })
  gradedBy: Admin | null;

  @Column({ type: 'timestamptz', nullable: true })
  gradedAt: Date | null;
}
