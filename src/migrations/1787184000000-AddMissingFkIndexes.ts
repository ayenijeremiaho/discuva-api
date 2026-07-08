import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMissingFkIndexes1787184000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_attendances_service_slot_id" ON "attendances" ("service_slot_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_follow_up_tasks_member_id" ON "follow_up_tasks" ("member_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_follow_up_tasks_event_id" ON "follow_up_tasks" ("event_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_first_timer_visits_first_timer_id" ON "first_timer_visits" ("first_timer_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_first_timer_visits_event_id" ON "first_timer_visits" ("event_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_follow_up_notes_task_id" ON "follow_up_notes" ("task_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_journal_entry_lines_entry_id" ON "finance_journal_entry_lines" ("journal_entry_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_journal_entry_lines_account_id" ON "finance_journal_entry_lines" ("account_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_offerings_fund_id" ON "finance_offerings" ("fund_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_reconciliation_rows_job_id" ON "finance_reconciliation_rows" ("job_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tithe_records_batch_id" ON "tithe_records" ("batch_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tithe_records_member_payment" ON "tithe_records" ("member_id", "payment_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_asset_checkouts_asset_id" ON "asset_checkouts" ("asset_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_asset_checkouts_asset_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tithe_records_member_payment"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tithe_records_batch_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_reconciliation_rows_job_id"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_offerings_fund_id"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_journal_entry_lines_account_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_journal_entry_lines_entry_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_follow_up_notes_task_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_first_timer_visits_event_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_first_timer_visits_first_timer_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_follow_up_tasks_event_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_follow_up_tasks_member_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_attendances_service_slot_id"`,
    );
  }
}
