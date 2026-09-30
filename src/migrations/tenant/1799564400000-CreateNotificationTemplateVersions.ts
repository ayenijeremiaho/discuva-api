import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationTemplateVersions1799564400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE notification_template_versions (
        id            UUID              NOT NULL DEFAULT gen_random_uuid(),
        channel       character varying NOT NULL,
        template_key  character varying NOT NULL,
        action        character varying NOT NULL,
        content       JSONB             NOT NULL,
        created_by_id UUID              NULL,
        created_at    TIMESTAMPTZ       NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ       NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_template_versions" PRIMARY KEY (id),
        CONSTRAINT "FK_notification_template_versions_created_by_id"
          FOREIGN KEY (created_by_id) REFERENCES members(id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_notification_template_versions_channel_template_key"
        ON notification_template_versions (channel, template_key, created_at)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_notification_template_versions_channel_template_key"`,
    );
    await queryRunner.query(`DROP TABLE notification_template_versions`);
  }
}
