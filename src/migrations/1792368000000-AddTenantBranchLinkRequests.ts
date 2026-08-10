import { MigrationInterface, QueryRunner } from 'typeorm';

// Control-plane — `public`, never a `search_path` target. Sibling of
// tenant_branch_invites (AddBranchHierarchy migration), for linking two
// already-onboarded tenants as parent/branch instead of inviting a church
// that doesn't have a tenant yet — see TenantBranchLinkRequest entity.
export class AddTenantBranchLinkRequests1792368000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS tenant_branch_link_requests (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        target_tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        status            VARCHAR NOT NULL DEFAULT 'pending',
        sponsor_plan      BOOLEAN NOT NULL DEFAULT false,
        responded_at      TIMESTAMPTZ NULL,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tenant_branch_link_requests_parent ON tenant_branch_link_requests(parent_tenant_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tenant_branch_link_requests_target ON tenant_branch_link_requests(target_tenant_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tenant_branch_link_requests`);
  }
}
