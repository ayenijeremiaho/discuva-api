import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEventCampus1805616000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['events', 'event_series']) {
      await queryRunner.query(
        `ALTER TABLE ${table} ADD COLUMN campus_id uuid REFERENCES campuses(id) ON DELETE SET NULL`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_${table}_campus_id" ON ${table} (campus_id) WHERE campus_id IS NOT NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['events', 'event_series']) {
      await queryRunner.query(`DROP INDEX "IDX_${table}_campus_id"`);
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN campus_id`);
    }
  }
}
