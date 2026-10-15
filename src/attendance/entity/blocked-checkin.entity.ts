import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Member } from '../../member/entity/member.entity';
import { Event } from '../../event/entity/event.entity';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { BaseEntity } from '../../utility/entity/base.entity';

export enum BlockedCheckinReasonEnum {
  TOO_FAR = 'TOO_FAR',
  IMPRECISE_LOCATION = 'IMPRECISE_LOCATION',
}

// One row per member per event; repeat attempts bump `attempts` and keep the closest reading.
@Entity({ name: 'blocked_checkins' })
@Unique('UQ_blocked_checkins_member_event', ['member', 'event'])
@Index('IDX_blocked_checkins_last_attempt', ['lastAttemptAt'])
@Index('IDX_blocked_checkins_event_last_attempt', ['event', 'lastAttemptAt'])
export class BlockedCheckin extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @ManyToOne(() => Event, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event: Event;

  @Index('IDX_blocked_checkins_service_slot_id')
  @ManyToOne(() => ServiceSlot, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'service_slot_id' })
  serviceSlot: ServiceSlot | null;

  @Column({ type: 'int', default: 1 })
  attempts: number;

  @Column({ type: 'int' })
  closestDistanceMeters: number;

  // Reported precision of the closest attempt.
  @Column({ type: 'int', nullable: true })
  accuracyMeters: number | null;

  @Column({ type: 'int' })
  allowedDistanceMeters: number;

  @Column({ type: 'character varying' })
  reason: BlockedCheckinReasonEnum;

  @Column({ type: 'timestamptz' })
  lastAttemptAt: Date;
}
