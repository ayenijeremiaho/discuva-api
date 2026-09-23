import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEventEndDateIndex1798700400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_events_end_date" ON events USING btree (end_date)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "IDX_events_end_date"
    `);
  }
}
