import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOfferingGivingOptionAndMember1798959600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE finance_offerings ALTER COLUMN type DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE finance_offerings ALTER COLUMN fund_id DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE finance_offerings ADD giving_option_id uuid NULL
        REFERENCES finance_giving_options(id) ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_offerings_giving_option_id" ON finance_offerings (giving_option_id)
    `);
    await queryRunner.query(`
      ALTER TABLE finance_offerings ADD member_id uuid NULL
        REFERENCES members(id) ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_offerings_member_id" ON finance_offerings (member_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_offerings_member_id"`);
    await queryRunner.query(`
      ALTER TABLE finance_offerings DROP COLUMN member_id
    `);
    await queryRunner.query(`DROP INDEX "IDX_offerings_giving_option_id"`);
    await queryRunner.query(`
      ALTER TABLE finance_offerings DROP COLUMN giving_option_id
    `);
    await queryRunner.query(`
      ALTER TABLE finance_offerings ALTER COLUMN fund_id SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE finance_offerings ALTER COLUMN type SET NOT NULL
    `);
  }
}
