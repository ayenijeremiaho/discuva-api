import { MigrationInterface, QueryRunner } from 'typeorm';

// Tenant-schema change. Backs the social media connector framework: admins
// register which platform accounts they intend to post to (social_accounts,
// isConnected stays false until a real per-platform OAuth integration is
// wired in), compose one post, and publish it to several accounts at once
// (social_posts + social_post_targets — one target row per account so each
// platform's own outcome is tracked independently).
export class AddSocialMedia1791417600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        platform            VARCHAR NOT NULL,
        display_name        VARCHAR NOT NULL,
        external_account_id VARCHAR NULL,
        is_connected        BOOLEAN NOT NULL DEFAULT false,
        connected_at        TIMESTAMPTZ NULL,
        connected_by        UUID NULL REFERENCES admins(id) ON DELETE SET NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_accounts_platform" ON social_accounts(platform)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS social_posts (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        content      TEXT NOT NULL,
        image_url    VARCHAR NULL,
        status       VARCHAR NOT NULL DEFAULT 'DRAFT',
        created_by   UUID NULL REFERENCES admins(id) ON DELETE SET NULL,
        published_at TIMESTAMPTZ NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS social_post_targets (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        social_post_id   UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
        social_account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
        status           VARCHAR NOT NULL DEFAULT 'PENDING',
        error_message    TEXT NULL,
        published_at     TIMESTAMPTZ NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_post_targets_social_post_id" ON social_post_targets(social_post_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_post_targets_social_account_id" ON social_post_targets(social_account_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS social_post_targets`);
    await queryRunner.query(`DROP TABLE IF EXISTS social_posts`);
    await queryRunner.query(`DROP TABLE IF EXISTS social_accounts`);
  }
}
