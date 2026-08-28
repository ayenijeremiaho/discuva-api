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
