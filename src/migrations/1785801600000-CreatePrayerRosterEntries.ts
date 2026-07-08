import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePrayerRosterEntries1785801600000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "prayer_roster_entries" (
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "worker_profile_id" UUID NOT NULL,
        "meeting_id" UUID NOT NULL,
        "assignmentType" CHARACTER VARYING NOT NULL,
        "status" CHARACTER VARYING NOT NULL DEFAULT 'SCHEDULED',
        "rescheduled_from_id" UUID,
        "reminderTwoDaySent" BOOLEAN NOT NULL DEFAULT false,
        "reminderDaySent" BOOLEAN NOT NULL DEFAULT false,
        CONSTRAINT "PK_prayer_roster_entries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_prayer_roster_worker" FOREIGN KEY ("worker_profile_id") REFERENCES "worker_profiles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_prayer_roster_meeting" FOREIGN KEY ("meeting_id") REFERENCES "prayer_meetings"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_prayer_roster_rescheduled_from" FOREIGN KEY ("rescheduled_from_id") REFERENCES "prayer_roster_entries"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_roster_worker" ON "prayer_roster_entries" ("worker_profile_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_roster_meeting" ON "prayer_roster_entries" ("meeting_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "prayer_roster_entries"`);
  }
}
