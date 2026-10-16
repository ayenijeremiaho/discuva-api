import { MigrationInterface, QueryRunner } from 'typeorm';

// The channel's name, read from YouTube when it's connected, so admins see which channel rather than its ID.
export class AddYoutubeIntegrationChannelTitle1794772807000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tenant_youtube_integrations ADD COLUMN IF NOT EXISTS channel_title VARCHAR`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tenant_youtube_integrations DROP COLUMN IF EXISTS channel_title`,
    );
  }
}
