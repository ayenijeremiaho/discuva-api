import { MigrationInterface, QueryRunner } from 'typeorm';

// The Event Schedule search is ILIKE '%term%' on the event name, which only a trigram index can serve.
export class AddEventNameSearchIndex1802160000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_events_name_trgm" ON events USING gin (name gin_trgm_ops)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_events_name_trgm"`);
  }
}
