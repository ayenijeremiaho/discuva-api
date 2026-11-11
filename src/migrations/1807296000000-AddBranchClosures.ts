import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 4: closing a branch on a set date. The church is kept read-only afterwards, never deleted.
export class AddBranchClosures1807296000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS closed_at timestamptz NULL`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS branch_closures (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        network_root_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        destination_tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        closes_on date NOT NULL,
        run_at timestamptz NOT NULL,
        status character varying NOT NULL,
        requested_by_tenant_id uuid NOT NULL,
        requested_by_member_id uuid NULL,
        summary jsonb NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz NULL
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_closures_scheduled ON branch_closures (tenant_id) WHERE status IN ('SCHEDULED', 'RUNNING')`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_branch_closures_run_at ON branch_closures (run_at) WHERE status = 'SCHEDULED'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_branch_closures_root ON branch_closures (network_root_id, created_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS branch_closures`);
    await queryRunner.query(
      `ALTER TABLE tenants DROP COLUMN IF EXISTS closed_at`,
    );
  }
}
