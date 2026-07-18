import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPerformanceIndexes1788393600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_members_birth_month_birth_day" ON "members" ("birth_month", "birth_day")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_first_timers_created_at" ON "first_timers" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_follow_up_tasks_status_due_date" ON "follow_up_tasks" ("status", "due_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tithe_upload_batches_status" ON "tithe_upload_batches" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tithe_unmatched_records_status" ON "tithe_unmatched_records" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tithe_dispute_records_status" ON "tithe_dispute_records" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tithe_payment_proofs_status" ON "tithe_payment_proofs" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_finance_requests_category_id" ON "finance_requests" ("category_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_finance_requests_category_id"`);
    await queryRunner.query(`DROP INDEX "IDX_tithe_payment_proofs_status"`);
    await queryRunner.query(`DROP INDEX "IDX_tithe_dispute_records_status"`);
    await queryRunner.query(`DROP INDEX "IDX_tithe_unmatched_records_status"`);
    await queryRunner.query(`DROP INDEX "IDX_tithe_upload_batches_status"`);
    await queryRunner.query(`DROP INDEX "IDX_follow_up_tasks_status_due_date"`);
    await queryRunner.query(`DROP INDEX "IDX_first_timers_created_at"`);
    await queryRunner.query(`DROP INDEX "IDX_members_birth_month_birth_day"`);
  }
}
