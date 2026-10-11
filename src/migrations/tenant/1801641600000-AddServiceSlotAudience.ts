import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddServiceSlotAudience1801641600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Lets one service in an event (e.g. a workers' meeting) be for workers or a group only; NULL = the event's audience.
    await queryRunner.query(`
      ALTER TABLE service_slots
        ADD COLUMN IF NOT EXISTS audience CHARACTER VARYING NULL,
        ADD COLUMN IF NOT EXISTS audience_group_id UUID NULL REFERENCES groups(id) ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_service_slots_audience_group_id" ON service_slots(audience_group_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_service_slots_audience_group_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE service_slots
        DROP COLUMN IF EXISTS audience_group_id,
        DROP COLUMN IF EXISTS audience
    `);
  }
}
