import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Event } from './event.entity';
import { EventConfig } from './event-config.entity';
import { Venue } from '../../venue/entity/venue.entity';
import { Attendance } from '../../attendance/entity/attendance.entity';
import { BaseEntity } from '../../utility/entity/base.entity';
import { MeetingFormatEnum } from '../../utility/enum/meeting-format.enum';

@Entity({ name: 'service_slots' })
export class ServiceSlot extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Event, (event) => event.serviceSlots, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'event_id' })
  event: Event;

  @Column({ default: 'Service' })
  name: string;

  @Index()
  @Column({ name: 'start_time', type: 'timestamptz' })
  startTime: Date;

  @Index()
  @Column({ name: 'end_time', type: 'timestamptz' })
  endTime: Date;

  @ManyToOne(() => EventConfig, (config) => config.serviceSlots, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'config_id' })
  config: EventConfig;

  // Per-slot timing overrides — null means "use config value"
  @Column({
    name: 'worker_checkin_start_override',
    nullable: true,
    type: 'int',
  })
  workerCheckinStartOverride: number | null;

  @Column({ name: 'worker_late_override', nullable: true, type: 'int' })
  workerLateOverride: number | null;

  @Column({
    name: 'member_checkin_start_override',
    nullable: true,
    type: 'int',
  })
  memberCheckinStartOverride: number | null;

  @Column({ name: 'checkin_stop_override', nullable: true, type: 'int' })
  checkinStopOverride: number | null;

  @Column({ name: 'allowed_distance_override', nullable: true, type: 'int' })
  allowedDistanceOverride: number | null;

  @Column({
    name: 'enforce_member_location_override',
    nullable: true,
    type: 'boolean',
  })
  enforceMemberLocationOverride: boolean | null;

  // Per-slot format override — null means "use config.defaultFormat". Lets
  // one occurrence of a recurring config go online (or back in-person)
  // without touching the shared config every other slot points at.
  @Column({ name: 'format_override', nullable: true })
  formatOverride: MeetingFormatEnum | null;

  /**
   * Per-slot venue override. When null the slot inherits config.defaultVenue.
   * SET NULL on delete so removing a venue clears the override without breaking the slot.
   */
  @ManyToOne(() => Venue, {
    nullable: true,
    eager: false,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'venue_override_id' })
  venueOverride: Venue | null;

  @OneToMany(() => Attendance, (attendance) => attendance.serviceSlot)
  attendances: Attendance[];

  /** Resolved venue: slot-level override takes priority over the config default. */
  get effectiveVenue(): Venue | null {
    return this.venueOverride ?? this.config?.defaultVenue ?? null;
  }
}
