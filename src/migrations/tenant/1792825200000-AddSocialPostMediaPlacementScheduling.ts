import { MigrationInterface, QueryRunner } from 'typeorm';

// Tenant-schema change, one pass covering three related additions to the
// social-media module's schema:
// - social_post_targets.placement: FEED/STORY/REEL — Instagram
//   Stories/Reels and YouTube Shorts are genuinely different publish
//   surfaces from a normal feed post, not a platform-level distinction.
// - social_post_media: replaces social_posts.image_url (a single free-text
//   URL, never a real upload) with real multi-attachment support.
// - social_posts.scheduled_for: backs "Schedule for later" — a delayed
//   Bull job reads this and calls the exact same publish path "Publish
//   Now" does.
export class AddSocialPostMediaPlacementScheduling1792825200000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE social_post_targets
        ADD COLUMN placement VARCHAR NOT NULL DEFAULT 'FEED'
    `);

    await queryRunner.query(`
      ALTER TABLE social_posts
        ADD COLUMN scheduled_for TIMESTAMPTZ NULL,
        DROP COLUMN image_url
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS social_post_media (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        social_post_id UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
        url            VARCHAR NOT NULL,
        public_id      VARCHAR NOT NULL,
        mime_type      VARCHAR NOT NULL,
        size_bytes     BIGINT NOT NULL,
        width          INT NULL,
        height         INT NULL,
        duration_seconds NUMERIC NULL,
        "order"        INT NOT NULL DEFAULT 0,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_post_media_social_post_id" ON social_post_media(social_post_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS social_post_media`);
    await queryRunner.query(`
      ALTER TABLE social_posts
        DROP COLUMN scheduled_for,
        ADD COLUMN image_url VARCHAR NULL
    `);
    await queryRunner.query(
      `ALTER TABLE social_post_targets DROP COLUMN placement`,
    );
  }
}
