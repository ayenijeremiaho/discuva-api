import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEmailLogProvider1786838400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS provider character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE email_logs DROP COLUMN IF EXISTS provider`,
    );
  }
}
