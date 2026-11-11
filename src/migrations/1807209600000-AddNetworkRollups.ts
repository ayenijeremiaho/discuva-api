import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 4: each branch's figures per month for the network report, each network's settings,
// and indexes for the root figures the report counts (moves in and out, milestones a church recorded).
export class AddNetworkRollups1807209600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS network_rollups (
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        period character(7) NOT NULL,
        network_root_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        metrics jsonb NOT NULL DEFAULT '{}',
        attention jsonb NOT NULL DEFAULT '[]',
        computed_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, period)
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_network_rollups_root_period ON network_rollups (network_root_id, period)`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS network_settings (
        network_root_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        settings jsonb NOT NULL DEFAULT '{}',
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_network_transfers_done_to ON network_transfers (to_tenant_id, decided_at) WHERE status = 'DONE'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_network_transfers_done_from ON network_transfers (from_tenant_id, decided_at) WHERE status = 'DONE'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_discuva_milestones_source_created ON discuva_milestones (source_tenant_id, created_at) WHERE source_tenant_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_discuva_milestones_source_created`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_network_transfers_done_from`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_network_transfers_done_to`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS network_settings`);
    await queryRunner.query(`DROP TABLE IF EXISTS network_rollups`);
  }
}
