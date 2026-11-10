import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// A person's one home branch within a network; other branches there are places they visit.
@Entity({ name: 'network_homes' })
export class NetworkHome {
  @PrimaryColumn({ type: 'uuid', name: 'account_id' })
  accountId: string;

  @PrimaryColumn({ type: 'uuid', name: 'network_root_id' })
  networkRootId: string;

  @Column({ type: 'uuid', name: 'home_tenant_id' })
  homeTenantId: string;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
