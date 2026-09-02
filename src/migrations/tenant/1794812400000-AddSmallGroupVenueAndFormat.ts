import { MigrationInterface, QueryRunner } from 'typeorm';

// Tenant-schema change. Lets a fellowship (SmallGroup) link to a registered
// Venue and/or meet online, alongside the existing free-text
// meeting_location — most fellowships meet informally (e.g. a member's
// home) with no registered Venue row, so venue_id is a nullable, purely
// informational addition, not a replacement. SET NULL (not RESTRICT):
// losing this link on venue deletion is fine for a fellowship, unlike
// EventConfig.default_venue_id which a live check-in flow depends on.
// meeting_format defaults every existing group to IN_PERSON, so nothing
// about current behavior changes until an admin deliberately picks ONLINE.
export class AddSmallGroupVenueAndFormat1794812400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE small_groups
        ADD COLUMN venue_id uuid NULL,
        ADD COLUMN meeting_format character varying NOT NULL DEFAULT 'IN_PERSON',
        ADD COLUMN meeting_link character varying NULL
    `);
    await queryRunner.query(`
      ALTER TABLE small_groups
        ADD CONSTRAINT "FK_small_groups_venue_id"
        FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_small_groups_venue_id" ON small_groups(venue_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_small_groups_venue_id"`);
    await queryRunner.query(`
      ALTER TABLE small_groups DROP CONSTRAINT "FK_small_groups_venue_id"
    `);
    await queryRunner.query(`
      ALTER TABLE small_groups
        DROP COLUMN venue_id,
        DROP COLUMN meeting_format,
        DROP COLUMN meeting_link
    `);
  }
}
