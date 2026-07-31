import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPrayerIndexes1785888000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_roster_entries_reminderTwoDaySent" ON "prayer_roster_entries" ("reminderTwoDaySent")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_roster_entries_reminderDaySent" ON "prayer_roster_entries" ("reminderDaySent")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_roster_entries_status" ON "prayer_roster_entries" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_meetings_status" ON "prayer_meetings" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_meetings_selectionStatus" ON "prayer_meetings" ("selectionStatus")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_prayer_meetings_selectionStatus"`);
    await queryRunner.query(`DROP INDEX "IDX_prayer_meetings_status"`);
    await queryRunner.query(`DROP INDEX "IDX_prayer_roster_entries_status"`);
    await queryRunner.query(
      `DROP INDEX "IDX_prayer_roster_entries_reminderDaySent"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_prayer_roster_entries_reminderTwoDaySent"`,
    );
  }
}
