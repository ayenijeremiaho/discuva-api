import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { ChurchClass } from './church-class.entity';
import { AssignmentSubmission } from './assignment-submission.entity';

@Entity({ name: 'assignments' })
export class Assignment extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => ChurchClass, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'church_class_id' })
  churchClass: ChurchClass;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  instructions: string | null;

  @Column({ default: 100 })
  maxScore: number;

  @Column({ type: 'timestamptz', nullable: true })
  dueDate: Date | null;

  // Unpublished assignments are admin-only drafts — invisible to students
  // and not submittable, same gating pattern as ChurchClass/Form isActive.
  @Column({ default: true })
  isPublished: boolean;

  @OneToMany(() => AssignmentSubmission, (s) => s.assignment)
  submissions: AssignmentSubmission[];
}
