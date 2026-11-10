import { Column, Entity, PrimaryColumn } from 'typeorm';

// A network's own name for one level ("Zone"), shown on screens and reports; a label, never a rule.
@Entity({ name: 'network_levels' })
export class NetworkLevel {
  @PrimaryColumn({ type: 'uuid', name: 'network_root_id' })
  networkRootId: string;

  @PrimaryColumn({ type: 'smallint' })
  depth: number;

  @Column({ type: 'varchar', length: 40 })
  name: string;
}
