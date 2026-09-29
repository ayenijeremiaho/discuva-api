import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationTemplateOverrides1799391600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE notification_template_overrides (
        id            UUID              NOT NULL DEFAULT gen_random_uuid(),
        channel       character varying NOT NULL,
        template_key  character varying NOT NULL,
        title         character varying NULL,
        body          text              NULL,
        updated_by_id UUID              NULL,
        created_at    TIMESTAMPTZ       NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ       NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_template_overrides" PRIMARY KEY (id),
        CONSTRAINT "FK_notification_template_overrides_updated_by_id"
          FOREIGN KEY (updated_by_id) REFERENCES members(id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_notification_template_overrides_channel_template_key"
        ON notification_template_overrides (channel, template_key)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "UQ_notification_template_overrides_channel_template_key"`,
    );
    await queryRunner.query(`DROP TABLE notification_template_overrides`);
  }
}
