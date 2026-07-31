import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuditLogTargetName1786665600000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE "audit_logs" ADD COLUMN "target_name" character varying`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE "audit_logs" DROP COLUMN "target_name"`);
  }
}
