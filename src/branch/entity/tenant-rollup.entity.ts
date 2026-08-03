import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// Control-plane table — lives in `public`, never a `search_path` target.
// One row per tenant, keyed by tenant_id directly (no separate uuid) —
// deliberately unsharded, distinct from the sharded tenant-schema data it
// was computed FROM (docs/MULTI_TENANT_MIGRATION.md §11.3). Every tenant
// gets a row here via the daily rollup cron, not just tenants with a
// parent — a branch invited later still needs history to show once linked,
// and it's simpler to compute for everyone than to special-case which
// tenants "count".
@Entity({ name: 'tenant_rollups' })
export class TenantRollup {
  @PrimaryColumn()
  tenantId: string;

  @Column({ default: 0 })
  memberCount: number;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  attendanceRate: number | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  totalGiving: number | null;

  @Column({ type: 'timestamptz' })
  computedAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
