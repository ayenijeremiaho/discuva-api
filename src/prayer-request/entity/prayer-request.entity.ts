import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Member } from '../../member/entity/member.entity';
import { BaseEntity } from '../../utility/entity/base.entity';
import { PrayerRequestStatusEnum } from '../enum/prayer-request-status.enum';

@Entity({ name: 'prayer_requests' })
export class PrayerRequest extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Nullable + SET NULL — a deactivated member's request history survives
  // regardless of the live FK. Name is snapshotted below for the same reason.
  // Indexed — getMyRequests() filters directly on this column.
  @Index()
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'member_id' })
  member: Member | null;

  @Column({ name: 'submitted_by_name' })
  submittedByName: string;

  @Column({ type: 'text' })
  content: string;

  @Index()
  @Column({
    type: 'character varying',
    default: PrayerRequestStatusEnum.OPEN,
  })
  status: PrayerRequestStatusEnum;
}
