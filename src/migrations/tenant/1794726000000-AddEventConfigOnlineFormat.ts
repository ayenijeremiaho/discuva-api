import { MigrationInterface, QueryRunner } from 'typeorm';

// Tenant-schema change. Lets a service be ONLINE-format with no physical
// venue, instead of every EventConfig requiring one. default_venue_id
// widens from NOT NULL to nullable — no backfill needed, every existing
// row already has a real venue, so this is a pure constraint relaxation.
// default_format defaults every existing config to IN_PERSON, so nothing
// about current behavior changes until an admin deliberately picks
// ONLINE. format_override on service_slots mirrors the 5 existing
// per-slot override columns, letting one occurrence of a recurring
// IN_PERSON config go online (or vice versa) without touching the shared
// config every other slot points at.
export class AddEventConfigOnlineFormat1794726000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE event_config ALTER COLUMN default_venue_id DROP NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE event_config
        ADD COLUMN default_format VARCHAR NOT NULL DEFAULT 'IN_PERSON',
        ADD COLUMN online_meeting_url VARCHAR NULL
    `);
    await queryRunner.query(`
      ALTER TABLE service_slots
        ADD COLUMN format_override VARCHAR NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE service_slots DROP COLUMN format_override
    `);
    await queryRunner.query(`
      ALTER TABLE event_config
        DROP COLUMN default_format,
        DROP COLUMN online_meeting_url
    `);
    // Fails loudly here (intended) if any tenant has since created an
    // ONLINE-format config with a null venue — that's real data this
    // rollback can't safely discard, so don't backfill a fake venue to
    // force it through; fix the offending rows or don't roll back.
    await queryRunner.query(
      `ALTER TABLE event_config ALTER COLUMN default_venue_id SET NOT NULL`,
    );
  }
}
