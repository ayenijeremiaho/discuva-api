import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { SmallGroup } from './small-group.entity';
import { Member } from '../../member/entity/member.entity';
import { SmallGroupAttendanceStatusEnum } from '../enum/small-group-attendance-status.enum';

@Entity({ name: 'small_group_attendance' })
@Unique(['group', 'member', 'meetingDate'])
export class SmallGroupAttendance extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => SmallGroup, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group: SmallGroup;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({ type: 'date', name: 'meeting_date' })
  meetingDate: string;

  @Column({ type: 'varchar' })
  status: SmallGroupAttendanceStatusEnum;
}
