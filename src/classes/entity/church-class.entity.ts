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
import { ClassEnrollment } from './class-enrollment.entity';
import { ClassType } from './class-type.entity';
import { ClassMaterial } from './class-material.entity';
import { ClassFacilitator } from './class-facilitator.entity';
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

  @Index()
  @Column({ default: ChurchClassStatusEnum.ACTIVE })
  status: ChurchClassStatusEnum;

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

  // Completion rules (null/false = no rule): checked when the class is closed and shown as progress.
  @Column({ type: 'int', nullable: true })
  minAttendancePercent: number | null;

  @Column({ default: false })
  requireAllAssignments: boolean;

  // Members can ask to join from the catalogue; capacity (null = no limit) counts active enrollments.
  @Column({ default: false })
  openForRequests: boolean;

  @Column({ type: 'int', nullable: true })
  capacity: number | null;

  @OneToMany(() => ClassEnrollment, (enrollment) => enrollment.churchClass)
  enrollments: ClassEnrollment[];

  @OneToMany(() => ClassMaterial, (material) => material.churchClass, {
    cascade: true,
  })
  materials: ClassMaterial[];

  @OneToMany(() => ClassFacilitator, (f) => f.churchClass, {
    cascade: true,
  })
  facilitators: ClassFacilitator[];
}
