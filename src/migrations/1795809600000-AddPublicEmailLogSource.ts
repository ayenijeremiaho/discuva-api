import { MigrationInterface, QueryRunner } from 'typeorm';

// Emails with no church context (sign-up confirmations) log here, and this table never got the tenant column.
export class AddPublicEmailLogSource1795809600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS source VARCHAR`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE email_logs DROP COLUMN IF EXISTS source`,
    );
  }
}
