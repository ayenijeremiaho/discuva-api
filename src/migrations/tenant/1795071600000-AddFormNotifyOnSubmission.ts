import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFormNotifyOnSubmission1795071600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE forms ADD notify_on_submission boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE forms DROP COLUMN notify_on_submission
    `);
  }
}
