import { MigrationInterface, QueryRunner } from 'typeorm';

// Control-plane table — lives in `public`, never a `search_path` target.
// Replaces the old tenant-schema `youtube_integration_state` (dropped by
// the companion tenant migration DropYoutubeIntegrationState): a WebSub
// notification is delivered by Google directly, with no Host header or any
// other clue which tenant it's for — only a channel id in the payload — so
// "which tenant owns this channel" has to be resolvable WITHOUT already
// knowing the tenant, which per-tenant-schema data structurally can't do.
// Same reasoning as TenantCommunicationProviderConfig (§4.12).
export class AddTenantYoutubeIntegrations1790812800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS tenant_youtube_integrations (
        id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id                UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
        channel_id               VARCHAR NOT NULL UNIQUE,
        api_key_encrypted        VARCHAR,
        last_announced_video_id  VARCHAR,
        subscription_expires_at  TIMESTAMPTZ,
        is_active                BOOLEAN NOT NULL DEFAULT true,
        created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // No separate index on channel_id — the UNIQUE constraint above already
    // creates one, which is exactly what the webhook lookup needs.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tenant_youtube_integrations`);
  }
}
