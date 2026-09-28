import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSmsDeliveryLogs1799132400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE sms_delivery_logs (
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        provider VARCHAR NOT NULL,
        recipient VARCHAR NOT NULL,
        message TEXT NOT NULL,
        status VARCHAR NOT NULL,
        provider_message_id VARCHAR NULL,
        provider_status VARCHAR NULL,
        error_message TEXT NULL,
        source_type VARCHAR NOT NULL DEFAULT 'direct',
        source_id UUID NULL,
        source_label VARCHAR NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sms_delivery_logs" PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_sms_delivery_logs_provider_message_recipient"
      ON sms_delivery_logs (provider, provider_message_id, recipient)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_sms_delivery_logs_created_at"
      ON sms_delivery_logs (created_at DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_sms_delivery_logs_created_at"`);
    await queryRunner.query(
      `DROP INDEX "IDX_sms_delivery_logs_provider_message_recipient"`,
    );
    await queryRunner.query(`DROP TABLE sms_delivery_logs`);
  }
}
