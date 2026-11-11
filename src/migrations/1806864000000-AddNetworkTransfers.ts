import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 4: moves between branches. Workers' requests wait here until their branch releases them.
export class AddNetworkTransfers1806864000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS network_transfers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        network_root_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        account_id uuid NOT NULL REFERENCES discuva_accounts(id) ON DELETE CASCADE,
        from_tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        to_tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        from_member_id uuid NOT NULL,
        to_member_id uuid NULL,
        status character varying NOT NULL,
        needs_release boolean NOT NULL DEFAULT false,
        requested_at timestamptz NOT NULL DEFAULT now(),
        decided_at timestamptz NULL,
        decided_by_member_id uuid NULL,
        decline_reason character varying(300) NULL
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_network_transfers_pending_account ON network_transfers (account_id) WHERE status = 'PENDING'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_network_transfers_pending_from ON network_transfers (from_tenant_id, requested_at) WHERE status = 'PENDING'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS network_transfers`);
  }
}
