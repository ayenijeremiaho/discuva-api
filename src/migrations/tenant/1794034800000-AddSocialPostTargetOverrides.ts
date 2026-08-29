import { MigrationInterface, QueryRunner } from 'typeorm';

// Per-target overrides for the composer's "customize for this platform"
// feature: contentOverride lets one target diverge from the shared
// SocialPost.content (e.g. a shortened caption for X's 280-char limit);
// media_focal_x/y are a normalized (0-1) click-to-crop-focus point used
// only for STORY/REEL placements — null means "use Cloudinary's g_auto
// content-aware cropping," not "no crop."
export class AddSocialPostTargetOverrides1794034800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE social_post_targets
      ADD COLUMN content_override text,
      ADD COLUMN media_focal_x numeric,
      ADD COLUMN media_focal_y numeric
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE social_post_targets
      DROP COLUMN content_override,
      DROP COLUMN media_focal_x,
      DROP COLUMN media_focal_y
    `);
  }
}
