import { Entity, PrimaryColumn } from 'typeorm';

// A branch hiding one shared network event from its members.
@Entity({ name: 'network_event_hides' })
export class NetworkEventHide {
  @PrimaryColumn({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @PrimaryColumn({ type: 'uuid', name: 'source_tenant_id' })
  sourceTenantId: string;

  @PrimaryColumn({ type: 'uuid', name: 'event_id' })
  eventId: string;
}
