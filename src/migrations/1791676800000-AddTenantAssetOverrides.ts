import { MigrationInterface, QueryRunner } from 'typeorm';

// Control-plane change — `public`, alongside `tenants` itself. Lets a
// church override any of the member PWA's bundled hero/backdrop images
// with their own (KNOWN_ASSETS, src/tenant/constants/known-assets.constant.ts).
// One row per (tenant, assetKey); a tenant with no row for a given key is
// just using the app's own bundled default — resolved client-side, not
// stored here.
export class AddTenantAssetOverrides1791676800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS tenant_asset_overrides (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        asset_key        VARCHAR NOT NULL,
        image_url        VARCHAR NOT NULL,
        image_public_id  VARCHAR NOT NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, asset_key)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tenant_asset_overrides_tenant_id ON tenant_asset_overrides(tenant_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tenant_asset_overrides`);
  }
}
