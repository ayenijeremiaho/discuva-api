import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGivingCheckoutPaymentDetails1794600000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE giving_checkout_sessions
        ADD provider_transaction_id character varying NULL,
        ADD payment_channel         character varying NULL,
        ADD paid_at                 TIMESTAMPTZ       NULL,
        ADD paid_amount_cents       BIGINT            NULL,
        ADD paid_currency           character varying NULL,
        ADD fees_cents              BIGINT            NULL,
        ADD payment_details         JSONB             NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE giving_checkout_sessions
        DROP COLUMN payment_details,
        DROP COLUMN fees_cents,
        DROP COLUMN paid_currency,
        DROP COLUMN paid_amount_cents,
        DROP COLUMN paid_at,
        DROP COLUMN payment_channel,
        DROP COLUMN provider_transaction_id
    `);
  }
}
