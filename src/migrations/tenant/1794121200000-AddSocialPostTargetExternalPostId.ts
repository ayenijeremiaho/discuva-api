import { MigrationInterface, QueryRunner } from 'typeorm';

// Every publisher's PublishResult already carries externalPostId (the
// platform's own id for the published post/video) but nothing has ever
// persisted it — there was nothing to look it up for until now. This is
// what a stats fetch (or any future "open this on the platform" link)
// needs per target.
export class AddSocialPostTargetExternalPostId1794121200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE social_post_targets ADD COLUMN external_post_id character varying
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE social_post_targets DROP COLUMN external_post_id
    `);
  }
}
