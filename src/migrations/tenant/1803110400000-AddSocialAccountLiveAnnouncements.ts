import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSocialAccountLiveAnnouncements1803110400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS announce_live BOOLEAN NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS last_live_id VARCHAR`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE social_accounts DROP COLUMN IF EXISTS last_live_id`,
    );
    await queryRunner.query(
      `ALTER TABLE social_accounts DROP COLUMN IF EXISTS announce_live`,
    );
  }
}
