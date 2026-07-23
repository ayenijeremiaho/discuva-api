import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';
import { Admin } from '../../admin/entity/admin.entity';

@Entity({ name: 'small_groups' })
export class SmallGroup extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // A cell leader isn't necessarily a Worker/Admin — any member can lead.
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'leader_id' })
  leader: Member | null;

  @Column({ type: 'varchar', nullable: true, name: 'meeting_day' })
  meetingDay: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'meeting_location' })
  meetingLocation: string | null;

  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: Admin | null;
}
