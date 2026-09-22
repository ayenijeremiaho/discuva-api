import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Member } from '../../member/entity/member.entity';
import { FirstTimer } from '../../follow-up/entity/first-timer.entity';
import { SundaySchoolSession } from './sunday-school-session.entity';
import { SundaySchoolAttendanceStatus } from '../enums/sunday-school-attendance-status.enum';
import { BaseEntity } from '../../utility/entity/base.entity';

// Exactly one of member/firstTimer is ever set (DB-enforced via
// CHK_sunday_school_attendances_member_xor_first_timer) — a class member
// with an existing account, or a first-timer checked in on the spot with no
// Member record yet. Two separate UNIQUE(session, X) constraints, not one
// composite — Postgres treats NULL as distinct per row, so a nullable
// member/firstTimer column already tolerates unlimited NULLs on its own
// without help from the other column.
@Entity('sunday_school_attendances')
@Unique(['session', 'member'])
@Unique(['session', 'firstTimer'])
export class SundaySchoolAttendance extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => SundaySchoolSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: SundaySchoolSession;

  @Index()
  @ManyToOne(() => Member, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member | null;

  @Index()
  @ManyToOne(() => FirstTimer, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'first_timer_id' })
  firstTimer: FirstTimer | null;

  @Column()
  status: SundaySchoolAttendanceStatus;

  @Column({ default: false })
  markedByTeacher: boolean;

  @Index()
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  markedAt: Date;
}
