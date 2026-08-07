import { MigrationInterface, QueryRunner } from 'typeorm';

// Control-plane changes — `tenants`/`tenant_onboarding_events` both live in
// `public`, never a `search_path` target.
//
// tenants.onboarding_status: orthogonal to is_active (which means "allowed
// to serve live traffic", also flipped by platform-admin suspend/reactivate)
// — tracks where a tenant is in TenantProvisioningProcessor's async
// provisioning lifecycle. Every existing row already completed the old
// synchronous provision() flow, so all backfill to ACTIVE.
//
// tenant_onboarding_events: a platform-level audit trail for that lifecycle
// (signup/provisioning start/complete/fail), distinct from AuditLogService
// (tenant-scoped, lives in each church's own schema) since these events
// happen before/independent of any tenant schema existing.
export class AddTenantOnboardingStatus1791936000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants
      ADD COLUMN IF NOT EXISTS onboarding_status VARCHAR NOT NULL DEFAULT 'PENDING'
    `);
    await queryRunner.query(`
      UPDATE tenants SET onboarding_status = 'ACTIVE'
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS tenant_onboarding_events (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        event       VARCHAR NOT NULL,
        actor_type  VARCHAR NOT NULL,
        actor_id    VARCHAR NULL,
        metadata    JSONB NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tenant_onboarding_events_tenant_id ON tenant_onboarding_events(tenant_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tenant_onboarding_events`);
    await queryRunner.query(`
      ALTER TABLE tenants DROP COLUMN IF EXISTS onboarding_status
    `);
  }
}
