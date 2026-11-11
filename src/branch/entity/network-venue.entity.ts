import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

// A copy of a branch's venue (already public), so finding which branch someone is at never reads inside a branch.
@Entity({ name: 'network_venues' })
export class NetworkVenue {
  @PrimaryColumn({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @PrimaryColumn({ type: 'uuid', name: 'venue_id' })
  venueId: string;

  @Index('idx_network_venues_root')
  @Column({ type: 'uuid', name: 'network_root_id' })
  networkRootId: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'double precision' })
  latitude: number;

  @Column({ type: 'double precision' })
  longitude: number;
}
