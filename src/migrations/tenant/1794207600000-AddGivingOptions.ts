import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGivingOptions1794207600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE finance_giving_options (
        id          UUID          NOT NULL DEFAULT gen_random_uuid(),
        name        VARCHAR       NOT NULL,
        description TEXT,
        fund_id     UUID,
        is_active   BOOLEAN       NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_giving_options" PRIMARY KEY (id),
        CONSTRAINT "FK_finance_giving_options_fund_id" FOREIGN KEY (fund_id)
          REFERENCES finance_funds (id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      ALTER TABLE tithe_records ADD giving_option_id UUID
    `);
    await queryRunner.query(`
      ALTER TABLE tithe_records
        ADD CONSTRAINT "FK_tithe_records_giving_option_id"
        FOREIGN KEY (giving_option_id) REFERENCES finance_giving_options (id)
        ON DELETE SET NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tithe_records DROP CONSTRAINT "FK_tithe_records_giving_option_id"
    `);
    await queryRunner.query(`
      ALTER TABLE tithe_records DROP COLUMN giving_option_id
    `);
    await queryRunner.query(`DROP TABLE finance_giving_options`);
  }
}
