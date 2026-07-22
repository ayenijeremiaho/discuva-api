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
import { PrayerRequest } from './prayer-request.entity';

@Entity({ name: 'testimonies' })
export class Testimony extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Indexed — getMyTestimonies() filters directly on this column.
  @Index()
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'member_id' })
  member: Member | null;

  @Column({ name: 'submitted_by_name' })
  submittedByName: string;

  // Null means "general testimony," not tied to a specific prayer request.
  @ManyToOne(() => PrayerRequest, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'prayer_request_id' })
  prayerRequest: PrayerRequest | null;

  @Column({ type: 'text' })
  content: string;

  // The submitter's own opt-in flag, set at submission time — no separate
  // publish/moderation step.
  @Index()
  @Column({ name: 'is_public', default: false })
  isPublic: boolean;
}
