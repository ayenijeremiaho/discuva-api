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
import { ClassSession } from './class-session.entity';
import { ClassEnrollment } from './class-enrollment.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { Member } from '../../member/entity/member.entity';
import { ClassAttendanceStatusEnum } from '../enum/class-attendance-status.enum';

// Keyed by enrollment so members and guests are marked the same way.
@Entity('class_session_attendances')
@Unique(['session', 'enrollment'])
export class ClassSessionAttendance extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ClassSession, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: ClassSession;

  @Index()
  @ManyToOne(() => ClassEnrollment, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'enrollment_id' })
  enrollment: ClassEnrollment;

  @Column({ type: 'varchar' })
  status: ClassAttendanceStatusEnum;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  markedAt: Date;

  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'marked_by_admin_id' })
  markedByAdmin: Admin | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'marked_by_member_id' })
  markedByMember: Member | null;
}
