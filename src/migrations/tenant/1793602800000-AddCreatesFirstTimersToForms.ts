import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCreatesFirstTimersToForms1793602800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE forms ADD creates_first_timers BOOLEAN NOT NULL DEFAULT false
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE forms DROP COLUMN creates_first_timers
    `);
  }
}
