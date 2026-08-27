import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { EnrollmentStatusEnum } from '../enum/enrollment-status.enum';
import { Member } from '../../member/entity/member.entity';
import { ChurchClass } from './church-class.entity';
import { Guest } from './guest.entity';
import { BaseEntity } from '../../utility/entity/base.entity';

@Entity('class_enrollments')
@Unique(['member', 'churchClass'])
@Unique(['guest', 'churchClass'])
@Index(['status', 'completedAt'])
export class ClassEnrollment extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Exactly one of member/guest is required (member_id IS NOT NULL OR
  // guest_id IS NOT NULL, enforced at the DB level) — not exclusive: a
  // converted guest ends up with both set, guest retained as history. See
  // ClassesService.convertGuestToMember.
  @ManyToOne(() => Member, { nullable: true, onDelete: 'CASCADE' })
  member: Member | null;

  @Index()
  @ManyToOne(() => Guest, { nullable: true, onDelete: 'SET NULL' })
  guest: Guest | null;

  // Why this specific enrollee is taking this specific class — per-
  // enrollment, not per-guest, since the same guest could take two classes
  // for two different reasons.
  @Column({ type: 'text', nullable: true })
  purpose: string | null;

  @Index()
  @ManyToOne(() => ChurchClass, { onDelete: 'CASCADE' })
  churchClass: ChurchClass;

  @Column({ default: EnrollmentStatusEnum.IN_PROGRESS })
  status: EnrollmentStatusEnum;

  @Index()
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  enrolledAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'certificate_issued', default: false })
  certificateIssued: boolean;

  @Column({
    name: 'certificate_issued_at',
    type: 'timestamptz',
    nullable: true,
  })
  certificateIssuedAt: Date | null;

  @Column({ name: 'certificate_number', type: 'varchar', nullable: true })
  certificateNumber: string | null;
}
