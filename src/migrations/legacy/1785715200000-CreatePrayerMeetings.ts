import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePrayerMeetings1785715200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "prayer_meetings" (
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "date" DATE NOT NULL,
        "month" INTEGER NOT NULL,
        "year" INTEGER NOT NULL,
        "day_config_id" UUID NOT NULL,
        "status" CHARACTER VARYING NOT NULL DEFAULT 'SCHEDULED',
        "selectionStatus" CHARACTER VARYING NOT NULL DEFAULT 'PENDING',
        "currentCapacity" INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT "PK_prayer_meetings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_prayer_meeting_day_config" FOREIGN KEY ("day_config_id") REFERENCES "prayer_day_configs"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_meeting_date" ON "prayer_meetings" ("date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_meeting_month_year" ON "prayer_meetings" ("month", "year")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "prayer_meetings"`);
  }
}
