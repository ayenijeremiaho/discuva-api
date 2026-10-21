import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTeamPostReactions1803974400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // One row per member, emoji and post (reply_id null) or reply.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_post_reactions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id uuid NOT NULL REFERENCES team_posts(id) ON DELETE CASCADE,
        reply_id uuid REFERENCES team_post_replies(id) ON DELETE CASCADE,
        member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        emoji character varying(16) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    // Also serve the per-page counts: post reactions by post_id, reply reactions by reply_id.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_team_post_reactions_post" ON team_post_reactions (post_id, member_id, emoji) WHERE reply_id IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_team_post_reactions_reply" ON team_post_reactions (reply_id, member_id, emoji) WHERE reply_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_post_reactions_member_id" ON team_post_reactions (member_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS team_post_reactions`);
  }
}
