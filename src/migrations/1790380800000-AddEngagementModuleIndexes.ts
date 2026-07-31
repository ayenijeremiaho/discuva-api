import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEngagementModuleIndexes1790380800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // service-rating: getComments() moderation feed filters WHERE comment IS
    // NOT NULL, ORDER BY created_at DESC, across all events — a partial
    // index matches that predicate exactly and stays small since most rows
    // have no comment.
    await queryRunner.query(`
      CREATE INDEX "IDX_service_ratings_created_at_with_comment"
      ON service_ratings (created_at DESC)
      WHERE comment IS NOT NULL
    `);

    // volunteer: listOpen() (the member-facing "browse open opportunities"
    // feed, hit on every load) filters WHERE status = 'OPEN' AND date >= now
    // ORDER BY date ASC — a composite index serves that better than the
    // existing date-only index.
    await queryRunner.query(`
      CREATE INDEX "IDX_volunteer_opportunities_status_date"
      ON volunteer_opportunities (status, date)
    `);

    // small-group: listMine() (a member's "My Fellowships" tab) filters by
    // member_id alone — the existing UQ_small_group_members_group_member
    // index leads with group_id, so it can't serve a member-only lookup.
    await queryRunner.query(`
      CREATE INDEX "IDX_small_group_members_member_id"
      ON small_group_members (member_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_small_group_members_member_id"`);
    await queryRunner.query(
      `DROP INDEX "IDX_volunteer_opportunities_status_date"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_service_ratings_created_at_with_comment"`,
    );
  }
}
