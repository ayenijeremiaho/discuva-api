import { MigrationInterface, QueryRunner } from 'typeorm';

// Replaced by public.tenant_youtube_integrations (main migration
// AddTenantYoutubeIntegrations) — this table's data (channel id + WebSub
// lease state) needs to be resolvable from an incoming webhook that has no
// tenant context at all, which tenant-schema data structurally can't
// support. No production tenant has ever had a real row here (the feature
// was never configured beyond the single pilot church's env vars, and
// those were never enabled in any environment this migrated through), so
// there's nothing to carry forward.
export class DropYoutubeIntegrationState1790899200000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS youtube_integration_state`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS youtube_integration_state (
        id uuid DEFAULT gen_random_uuid() NOT NULL,
        channel_id character varying NOT NULL,
        last_announced_video_id character varying,
        subscription_expires_at timestamp with time zone,
        created_at timestamp with time zone DEFAULT now() NOT NULL,
        updated_at timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "PK_youtube_integration_state" PRIMARY KEY (id),
        CONSTRAINT "UQ_youtube_integration_state_channel_id" UNIQUE (channel_id)
      )
    `);
  }
}
