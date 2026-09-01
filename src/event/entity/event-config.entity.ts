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
   * Deleting a venue that is a defaultVenue on any config will be rejected by the DB FK constraint.
   */
  @ManyToOne(() => Venue, {
    nullable: false,
    eager: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'default_venue_id' })
  defaultVenue: Venue;

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

  @OneToMany(() => ServiceSlot, (slot) => slot.config, { nullable: true })
  serviceSlots: ServiceSlot[];
}
