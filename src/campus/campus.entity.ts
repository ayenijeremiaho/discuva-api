import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../utility/entity/base.entity';
import { Member } from '../member/entity/member.entity';

export enum CampusMoveStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  DECLINED = 'DECLINED',
}

@Entity({ name: 'campuses' })
export class Campus extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}

// One row per completed move, which is what the joined and left views read.
@Entity({ name: 'member_campus_moves' })
@Index('IDX_member_campus_moves_to', ['toCampusId', 'createdAt'])
@Index('IDX_member_campus_moves_from', ['fromCampusId', 'createdAt'])
@Index('IDX_member_campus_moves_created', ['createdAt'])
export class MemberCampusMove extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'member_id' })
  memberId: string;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({ type: 'uuid', name: 'from_campus_id', nullable: true })
  fromCampusId: string | null;

  @ManyToOne(() => Campus, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'from_campus_id' })
  fromCampus: Campus | null;

  @Column({ type: 'uuid', name: 'to_campus_id', nullable: true })
  toCampusId: string | null;

  @ManyToOne(() => Campus, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'to_campus_id' })
  toCampus: Campus | null;
}

@Entity({ name: 'worker_campus_move_requests' })
@Index('IDX_worker_campus_move_requests_status', ['status', 'createdAt'])
export class WorkerCampusMoveRequest extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'member_id' })
  memberId: string;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({ type: 'uuid', name: 'from_campus_id', nullable: true })
  fromCampusId: string | null;

  @ManyToOne(() => Campus, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'from_campus_id' })
  fromCampus: Campus | null;

  @Column({ type: 'uuid', name: 'to_campus_id' })
  toCampusId: string;

  @ManyToOne(() => Campus, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'to_campus_id' })
  toCampus: Campus;

  @Column({ type: 'varchar', default: CampusMoveStatus.PENDING })
  status: CampusMoveStatus;

  @Column({ type: 'uuid', name: 'decided_by_member_id', nullable: true })
  decidedByMemberId: string | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'decided_by_member_id' })
  decidedBy: Member | null;

  @Column({ type: 'timestamptz', name: 'decided_at', nullable: true })
  decidedAt: Date | null;
}
