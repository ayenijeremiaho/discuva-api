import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFollowUpTaskIndexes1786752000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_follow_up_tasks_status" ON "follow_up_tasks" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_follow_up_tasks_assigned_to_id" ON "follow_up_tasks" ("assigned_to_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_follow_up_tasks_type" ON "follow_up_tasks" ("type")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_follow_up_tasks_type"`);
    await queryRunner.query(`DROP INDEX "IDX_follow_up_tasks_assigned_to_id"`);
    await queryRunner.query(`DROP INDEX "IDX_follow_up_tasks_status"`);
  }
}
