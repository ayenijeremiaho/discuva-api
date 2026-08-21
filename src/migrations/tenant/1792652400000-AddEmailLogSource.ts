import { MigrationInterface, QueryRunner } from 'typeorm';

// Distinguishes "sent via the church's own configured provider" from "sent
// via Discuva's platform-default provider" — email_logs.provider already
// stored a technical name (gmail/resend/etc.) but nothing marked which of
// the two cases it was. Existing rows get NULL (unknown, not either label —
// the frontend must not guess for historical data).
export class AddEmailLogSource1792652400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE email_logs ADD COLUMN source VARCHAR`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE email_logs DROP COLUMN source`);
  }
}
