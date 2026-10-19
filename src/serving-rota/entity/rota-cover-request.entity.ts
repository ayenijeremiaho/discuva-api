import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Department } from '../../department/entity/department.entity';
import { Member } from '../../member/entity/member.entity';
import { RotaAssignment } from './rota-assignment.entity';

export enum CoverStatusEnum {
  OPEN = 'OPEN',
  ACCEPTED = 'ACCEPTED',
  CANCELLED = 'CANCELLED',
}

// "I can't make it": open to the whole department, or to one teammate. The first to accept takes the duty.
@Entity({ name: 'rota_cover_requests' })
export class RotaCoverRequest extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => RotaAssignment, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assignment_id' })
  assignment: RotaAssignment;

  @ManyToOne(() => Department, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'department_id' })
  department: Department;

  @Index()
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'requested_by_id' })
  requestedBy: Member | null;

  @Index()
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'target_member_id' })
  targetMember: Member | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', default: CoverStatusEnum.OPEN })
  status: CoverStatusEnum;

  @Index()
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'accepted_by_id' })
  acceptedBy: Member | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;
}
