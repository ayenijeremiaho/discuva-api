import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { ChurchClass } from './church-class.entity';
import { Member } from '../../member/entity/member.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { ClassJoinRequestStatusEnum } from '../enum/class-join-request-status.enum';

// A member asking to join a class that's open for requests; an approval creates the enrollment.
@Entity('class_join_requests')
export class ClassJoinRequest extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => ChurchClass, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'church_class_id' })
  churchClass: ChurchClass;

  @Index()
  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ type: 'varchar', default: ClassJoinRequestStatusEnum.PENDING })
  status: ClassJoinRequestStatusEnum;

  @Column({ type: 'text', nullable: true })
  declineReason: string | null;

  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'decided_by_admin_id' })
  decidedByAdmin: Admin | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;
}
