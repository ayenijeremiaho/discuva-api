import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

// A copy of a networked church's upcoming event: the agenda reads these, and branches see the shared ones.
@Entity({ name: 'network_events' })
@Index('idx_network_events_root_start', ['networkRootId', 'startTime'])
export class NetworkEvent {
  @PrimaryColumn({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @PrimaryColumn({ type: 'uuid', name: 'event_id' })
  eventId: string;

  @Column({ type: 'uuid', name: 'network_root_id' })
  networkRootId: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description: string | null;

  @Column({ type: 'timestamptz', name: 'start_time' })
  startTime: Date;

  @Column({ type: 'timestamptz', name: 'end_time' })
  endTime: Date;

  @Column({ type: 'varchar' })
  audience: string;

  @Column({ type: 'varchar', name: 'venue_name', nullable: true })
  venueName: string | null;

  @Column({ type: 'int', name: 'service_count', default: 1 })
  serviceCount: number;

  @Column({ default: false })
  shared: boolean;
}
