import { MigrationInterface, QueryRunner } from 'typeorm';

// AddGivingOptions (1794207600000) added two FK columns without their
// supporting indexes — Postgres never auto-indexes the referencing side of
// a foreign key, same gap the AddMissingForeignKeyIndexes migrations
// backfilled project-wide. Sibling relations on TitheRecord (member_id,
// batch_id) are both already indexed; these two were missed.
export class AddGivingOptionsForeignKeyIndexes1794294000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tithe_records_giving_option_id" ON tithe_records (giving_option_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_finance_giving_options_fund_id" ON finance_giving_options (fund_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_finance_giving_options_fund_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tithe_records_giving_option_id"`,
    );
  }
}
