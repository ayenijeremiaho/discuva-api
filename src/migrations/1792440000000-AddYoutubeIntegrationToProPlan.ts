import { MigrationInterface, QueryRunner } from 'typeorm';

// YoutubeIntegrationController is newly gated behind @RequiresModule/
// @RequiresPlan (church-settings/constants/known-modules.constant.ts adds
// 'youtube_integration') — Pro-only from day one, same treatment as
// Tithe/Giving and Social Media (BYOK, zero cost to Discuva, gated on
// business-value grounds).
export class AddYoutubeIntegrationToProPlan1792440000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans
       SET features = array_append(features, 'youtube_integration')
       WHERE id = 'pro'
         AND NOT ('youtube_integration' = ANY(features))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans
       SET features = array_remove(features, 'youtube_integration')
       WHERE id = 'pro'`,
    );
  }
}
