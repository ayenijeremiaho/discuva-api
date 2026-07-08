import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePrayerScheduleConfig1785369600000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "prayer_schedule_configs" (
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "selectionWindowDays" INTEGER NOT NULL DEFAULT 7,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        CONSTRAINT "PK_prayer_schedule_configs" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "prayer_schedule_configs"`);
  }
}
