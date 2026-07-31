import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePrayerDayConfigs1785456000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "prayer_day_configs" (
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "dayOfWeek" INTEGER NOT NULL,
        "mode" CHARACTER VARYING NOT NULL DEFAULT 'VIRTUAL',
        "startTime" CHARACTER VARYING NOT NULL DEFAULT '00:00',
        "endTime" CHARACTER VARYING NOT NULL DEFAULT '01:00',
        "maxCapacity" INTEGER NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        CONSTRAINT "PK_prayer_day_configs" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "prayer_day_configs"`);
  }
}
