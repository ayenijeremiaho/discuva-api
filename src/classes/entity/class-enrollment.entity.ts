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
import { BaseEntity } from '../../utility/entity/base.entity';

@Entity('class_enrollments')
@Unique(['member', 'churchClass'])
@Index(['status', 'completedAt'])
export class ClassEnrollment extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  member: Member;

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
