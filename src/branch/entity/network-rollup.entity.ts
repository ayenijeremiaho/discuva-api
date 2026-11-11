import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type {
  BranchAttention,
  BranchMetrics,
} from '../report/network-report.types';

// One branch's figures for one month. Only the current month (and last month until the 7th) is ever recalculated.
@Entity({ name: 'network_rollups' })
@Index('idx_network_rollups_root_period', ['networkRootId', 'period'])
export class NetworkRollup {
  @PrimaryColumn({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  // 'YYYY-MM'
  @PrimaryColumn({ type: 'char', length: 7 })
  period: string;

  @Column({ type: 'uuid', name: 'network_root_id' })
  networkRootId: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metrics: BranchMetrics;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  attention: BranchAttention[];

  @Column({ type: 'timestamptz', name: 'computed_at' })
  computedAt: Date;
}
