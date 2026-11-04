import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCommunitySpace1805270400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS community_categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name character varying(50) NOT NULL,
        position integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_community_categories_name" ON community_categories (lower(name))`,
    );

    await queryRunner.query(`
      ALTER TABLE team_posts
        ADD COLUMN IF NOT EXISTS title character varying(120),
        ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES community_categories(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS locked_at timestamptz,
        ADD COLUMN IF NOT EXISTS locked_by_id uuid REFERENCES members(id) ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_posts_category_feed" ON team_posts (space_id, category_id, last_activity_at DESC, id DESC) WHERE removed_at IS NULL AND category_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_posts_locked_by_id" ON team_posts (locked_by_id) WHERE locked_by_id IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS community_moderators (
        member_id uuid PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
        added_by_id uuid REFERENCES members(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_community_moderators_added_by" ON community_moderators (added_by_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS community_mutes (
        member_id uuid PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
        until timestamptz NOT NULL,
        reason character varying(300),
        muted_by_id uuid REFERENCES members(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_community_mutes_muted_by" ON community_mutes (muted_by_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS post_reports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id uuid NOT NULL REFERENCES team_posts(id) ON DELETE CASCADE,
        reply_id uuid REFERENCES team_post_replies(id) ON DELETE CASCADE,
        reporter_id uuid REFERENCES members(id) ON DELETE SET NULL,
        reason character varying(300) NOT NULL,
        resolved_at timestamptz,
        resolved_by_id uuid REFERENCES members(id) ON DELETE SET NULL,
        outcome character varying,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_post_reports_open" ON post_reports (created_at DESC) WHERE resolved_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_post_reports_reporter_item" ON post_reports (reporter_id, post_id, COALESCE(reply_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE resolved_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_post_reports_post" ON post_reports (post_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_post_reports_reply" ON post_reports (reply_id) WHERE reply_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_post_reports_resolved_by" ON post_reports (resolved_by_id) WHERE resolved_by_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS post_reports`);
    await queryRunner.query(`DROP TABLE IF EXISTS community_mutes`);
    await queryRunner.query(`DROP TABLE IF EXISTS community_moderators`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_team_posts_locked_by_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_team_posts_category_feed"`,
    );
    await queryRunner.query(`
      ALTER TABLE team_posts
        DROP COLUMN IF EXISTS locked_by_id,
        DROP COLUMN IF EXISTS locked_at,
        DROP COLUMN IF EXISTS category_id,
        DROP COLUMN IF EXISTS title
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS community_categories`);
  }
}
