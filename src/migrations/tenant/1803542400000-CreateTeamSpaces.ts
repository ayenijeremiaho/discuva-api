import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTeamSpaces1803542400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_spaces (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        kind character varying NOT NULL,
        ref_id uuid NOT NULL,
        leaders_only boolean NOT NULL DEFAULT false,
        last_activity_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_team_spaces_kind_ref" UNIQUE (kind, ref_id)
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_spaces_last_activity_at" ON team_spaces (last_activity_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_posts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        space_id uuid NOT NULL REFERENCES team_spaces(id) ON DELETE CASCADE,
        author_id uuid REFERENCES members(id) ON DELETE SET NULL,
        body text NOT NULL,
        pinned boolean NOT NULL DEFAULT false,
        reply_count integer NOT NULL DEFAULT 0,
        last_activity_at timestamptz NOT NULL,
        edited_at timestamptz,
        removed_at timestamptz,
        removed_by_id uuid REFERENCES members(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    // The feed: newest activity first, a page at a time, skipping removed posts.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_posts_feed" ON team_posts (space_id, last_activity_at DESC, id DESC) WHERE removed_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_posts_pinned" ON team_posts (space_id) WHERE pinned AND removed_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_posts_author_id" ON team_posts (author_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_posts_removed_by_id" ON team_posts (removed_by_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_post_replies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id uuid NOT NULL REFERENCES team_posts(id) ON DELETE CASCADE,
        author_id uuid REFERENCES members(id) ON DELETE SET NULL,
        body text NOT NULL,
        edited_at timestamptz,
        removed_at timestamptz,
        removed_by_id uuid REFERENCES members(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_post_replies_thread" ON team_post_replies (post_id, created_at, id) WHERE removed_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_post_replies_author_id" ON team_post_replies (author_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_post_replies_removed_by_id" ON team_post_replies (removed_by_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_space_reads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        space_id uuid NOT NULL REFERENCES team_spaces(id) ON DELETE CASCADE,
        last_read_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_team_space_reads_member_space" UNIQUE (member_id, space_id)
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_space_reads_space_id" ON team_space_reads (space_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS team_space_reads`);
    await queryRunner.query(`DROP TABLE IF EXISTS team_post_replies`);
    await queryRunner.query(`DROP TABLE IF EXISTS team_posts`);
    await queryRunner.query(`DROP TABLE IF EXISTS team_spaces`);
  }
}
