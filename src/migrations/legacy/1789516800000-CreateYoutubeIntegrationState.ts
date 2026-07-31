import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateYoutubeIntegrationState1789516800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE youtube_integration_state (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        channel_id character varying NOT NULL UNIQUE,
        last_announced_video_id character varying,
        subscription_expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE youtube_integration_state`);
  }
}
