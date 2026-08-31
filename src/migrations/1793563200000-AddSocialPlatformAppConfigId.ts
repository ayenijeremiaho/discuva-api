import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSocialPlatformAppConfigId1793563200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE social_platform_apps ADD config_id character varying
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE social_platform_apps DROP COLUMN config_id
    `);
  }
}
