import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Member } from '../../member/entity/member.entity';
import { ChildClassGroup } from './child-class-group.entity';
import { BaseEntity } from '../../utility/entity/base.entity';

// A team member's room for one church day; no room means the front desk.
@Entity('child_room_duties')
@Index('uq_child_room_duties_member_day', ['member', 'day'], { unique: true })
@Index('idx_child_room_duties_day_room', ['day', 'classGroup'])
export class ChildRoomDuty extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Index('idx_child_room_duties_class_group_id')
  @ManyToOne(() => ChildClassGroup, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'class_group_id' })
  classGroup: ChildClassGroup | null;

  @Column({ type: 'date' })
  day: string;
}
