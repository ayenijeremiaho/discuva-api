import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSocialPlatformApps1793217600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS social_platform_apps (
                platform                 VARCHAR PRIMARY KEY,
                client_id                VARCHAR NOT NULL,
                client_secret_encrypted  VARCHAR NOT NULL,
                redirect_uri             VARCHAR NOT NULL,
                scopes                   VARCHAR NOT NULL,
                is_active                BOOLEAN NOT NULL DEFAULT true
            )
        `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE social_platform_apps`);
  }
}
