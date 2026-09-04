import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ServiceSlot } from './service-slot.entity';
import { Venue } from '../../venue/entity/venue.entity';
import { BaseEntity } from '../../utility/entity/base.entity';
import { MeetingFormatEnum } from '../../utility/enum/meeting-format.enum';

@Entity({ name: 'event_config' })
export class EventConfig extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ nullable: true })
  description: string;

  /**
   * Default venue for any slot that uses this config and has no venueOverride.
   * Null when defaultFormat is ONLINE — an online service has no physical
   * location to resolve. Deleting a venue that is a defaultVenue on any
   * config will still be rejected by the DB FK constraint (RESTRICT),
   * since an IN_PERSON config can never legitimately lose its venue.
   */
  @ManyToOne(() => Venue, {
    nullable: true,
    eager: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'default_venue_id' })
  defaultVenue: Venue | null;

  // IN_PERSON (default, matches every config's behavior before this column
  // existed) requires defaultVenue; ONLINE requires defaultVenue to be
  // null instead — enforced in EventConfigService, not here.
  @Column({ name: 'default_format', default: MeetingFormatEnum.IN_PERSON })
  defaultFormat: MeetingFormatEnum;

  @Column({ name: 'online_meeting_url', nullable: true })
  onlineMeetingUrl: string | null;

  /**
   * Seconds before slot startTime that workers can begin checking in.
   * Negative value = check-in opens before the service starts.
   */
  @Column({ name: 'worker_checkin_start_offset_seconds' })
  workerCheckinStartOffsetSeconds: number;

  /** Seconds after slot startTime at which a worker check-in is considered late. */
  @Column({ name: 'worker_late_offset_seconds' })
  workerLateOffsetSeconds: number;

  /** Seconds before/after slot startTime that members can begin checking in. */
  @Column({ name: 'member_checkin_start_offset_seconds' })
  memberCheckinStartOffsetSeconds: number;

  /** Seconds after slot startTime when check-in closes for everyone. */
  @Column({ name: 'checkin_stop_offset_seconds' })
  checkinStopOffsetSeconds: number;

  @Column({ name: 'allowed_distance_in_meters' })
  allowedDistanceInMeters: number;

  // When true, ProgrammeAutoStartScheduler starts a slot's DRAFT programme
  // on its own once the slot's startTime arrives (within its lookback
  // window) and nobody's started it manually yet — see the scheduler's own
  // header comment for the full precondition list.
  @Column({ name: 'auto_start_session', default: false })
  autoStartSession: boolean;

  // When true, a member (not just a worker, who is always required
  // regardless of this) must submit their location to check in to a slot
  // using this config — enforced in AttendanceService.checkin(), resolved
  // per-slot via ServiceSlot.enforceMemberLocationOverride. Separate from
  // the tenant-wide distance-check-enforcement setting: that one decides
  // whether a too-far check-in is rejected; this one decides whether
  // location must be submitted at all.
  @Column({ name: 'enforce_member_location', default: false })
  enforceMemberLocation: boolean;

  @OneToMany(() => ServiceSlot, (slot) => slot.config, { nullable: true })
  serviceSlots: ServiceSlot[];
}
