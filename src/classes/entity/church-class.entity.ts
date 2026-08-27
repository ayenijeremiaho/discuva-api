import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ChurchClassStatusEnum } from '../enum/church-class-status.enum';
import { Member } from '../../member/entity/member.entity';
import { ClassEnrollment } from './class-enrollment.entity';
import { ClassType } from './class-type.entity';
import { BaseEntity } from '../../utility/entity/base.entity';

@Entity('church_classes')
export class ChurchClass extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Index()
  @ManyToOne(() => ClassType, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'class_type_id' })
  classType: ClassType;

  @Column({ nullable: true, type: 'text' })
  description: string | null;

  // Link to the class's syllabus/manual/study material — hosted externally
  // (Google Drive, PDF link, etc.), not uploaded through this API.
  @Column({ nullable: true, name: 'document_url' })
  documentUrl: string | null;

  @Index()
  @Column({ default: ChurchClassStatusEnum.ACTIVE })
  status: ChurchClassStatusEnum;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  facilitator: Member | null;

  @Column({ type: 'date', nullable: true })
  startDate: string | null;

  @Column({ type: 'date', nullable: true })
  endDate: string | null;

  // Single "next session" field the facilitator updates as the class
  // progresses week to week — not a full multi-session schedule entity.
  @Column({ name: 'next_session_at', type: 'timestamptz', nullable: true })
  nextSessionAt: Date | null;

  @Column({ name: 'meeting_link', nullable: true })
  meetingLink: string | null;

  @OneToMany(() => ClassEnrollment, (enrollment) => enrollment.churchClass)
  enrollments: ClassEnrollment[];
}
