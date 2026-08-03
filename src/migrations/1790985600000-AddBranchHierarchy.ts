import { MigrationInterface, QueryRunner } from 'typeorm';

// Control-plane changes — all in `public`, never a `search_path` target.
// Implements docs/MULTI_TENANT_MIGRATION.md §11's "local compute, pushed
// rollups" design: a branch is a tenant with parent_tenant_id set, and each
// tenant computes its own tenant_rollups row against its own schema/shard —
// there is no cross-tenant read path for the parent's overview to get wrong,
// because there is no cross-tenant read at all (§11.2).
export class AddBranchHierarchy1790985600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants
      ADD COLUMN IF NOT EXISTS parent_tenant_id UUID NULL REFERENCES tenants(id) ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tenants_parent_tenant_id ON tenants(parent_tenant_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS tenant_branch_invites (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        email               VARCHAR NOT NULL,
        token               VARCHAR NOT NULL UNIQUE,
        status              VARCHAR NOT NULL DEFAULT 'pending',
        expires_at          TIMESTAMPTZ NOT NULL,
        accepted_tenant_id  UUID NULL REFERENCES tenants(id) ON DELETE SET NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tenant_branch_invites_parent ON tenant_branch_invites(parent_tenant_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS tenant_rollups (
        tenant_id         UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        member_count      INT NOT NULL DEFAULT 0,
        attendance_rate   NUMERIC(5,2),
        total_giving      NUMERIC(14,2),
        computed_at       TIMESTAMPTZ NOT NULL,
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tenant_rollups`);
    await queryRunner.query(`DROP TABLE IF EXISTS tenant_branch_invites`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_tenants_parent_tenant_id`,
    );
    await queryRunner.query(
      `ALTER TABLE tenants DROP COLUMN IF EXISTS parent_tenant_id`,
    );
  }
}
