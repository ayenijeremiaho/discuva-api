import { EventAudienceEnum } from '../enums/event-audience.enum';
import { Group } from '../../group/entity/group.entity';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ServiceSlot } from './service-slot.entity';
import { Attendance } from '../../attendance/entity/attendance.entity';
import { BaseEntity } from '../../utility/entity/base.entity';

@Entity({ name: 'events' })
export class Event extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Index()
  @Column({ name: 'event_date', type: 'date' })
  eventDate: Date;

  @Column({ name: 'end_date', type: 'date' })
  endDate: Date;

  /** Precise instant of the earliest slot's startTime — for "is this event live/past" checks; eventDate stays date-only for date-range queries. */
  @Column({ name: 'start_time', type: 'timestamptz' })
  startTime: Date;

  /** Precise instant of the latest slot's endTime — for "is this event live/past" checks; endDate stays date-only for date-range queries. */
  @Index()
  @Column({ name: 'end_time', type: 'timestamptz' })
  endTime: Date;

  @Column({ name: 'attendance_marked', default: false })
  attendanceMarked: boolean;

  @Column({ name: 'online_attendance_enabled', default: false })
  onlineAttendanceEnabled: boolean;

  @Column({
    name: 'online_notification_sent_at',
    nullable: true,
    type: 'timestamptz',
  })
  onlineNotificationSentAt: Date | null;

  // When members can no longer confirm online attendance; set with onlineNotificationSentAt.
  @Column({
    name: 'online_confirm_closes_at',
    nullable: true,
    type: 'timestamptz',
  })
  onlineConfirmClosesAt: Date | null;

  @Column({ name: 'thank_you_sent_at', nullable: true, type: 'timestamptz' })
  thankYouSentAt: Date | null;

  @Column({ nullable: true })
  @Index()
  recurringEventId: string;

  // The church-local date this occurrence stands for in its series.
  @Column({ name: 'series_occurrence_date', type: 'date', nullable: true })
  seriesOccurrenceDate: string | null;

  @Column({ type: 'varchar', default: EventAudienceEnum.EVERYONE })
  audience: EventAudienceEnum;

  // GROUP only; if the group is deleted the event falls back to everyone.
  @Column({ name: 'audience_group_id', type: 'uuid', nullable: true })
  audienceGroupId: string | null;

  @ManyToOne(() => Group, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'audience_group_id' })
  audienceGroup?: Group | null;

  @OneToMany(() => ServiceSlot, (slot) => slot.event, { cascade: true })
  serviceSlots: ServiceSlot[];

  @OneToMany(() => Attendance, (a) => a.event)
  attendances: Attendance[];

  /** Populated on GET endpoints — true if the calling user has checked in to any slot of this event. */
  checkedIn?: boolean;

  /** Populated on GET endpoints — details of the user's check-in, or null if not checked in. */
  myCheckin?: {
    slotId: string;
    slotName: string | null;
    status: string;
    checkinTime: Date | null;
  } | null;
}
