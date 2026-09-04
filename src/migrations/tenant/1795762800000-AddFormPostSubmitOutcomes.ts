import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFormPostSubmitOutcomes1795762800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE forms ADD post_submit_outcomes jsonb NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE forms DROP COLUMN post_submit_outcomes
    `);
  }
}
