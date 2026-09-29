import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEmailContentToNotificationTemplateOverrides1799478000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE notification_template_overrides ADD content JSONB NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE notification_template_overrides DROP COLUMN content`,
    );
  }
}
