import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { NetworkSettingsValues } from '../report/network-settings.constants';

// A network's own choices within the platform's limits; anything not set uses the default.
@Entity({ name: 'network_settings' })
export class NetworkSettings {
  @PrimaryColumn({ type: 'uuid', name: 'network_root_id' })
  networkRootId: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  settings: Partial<NetworkSettingsValues>;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
