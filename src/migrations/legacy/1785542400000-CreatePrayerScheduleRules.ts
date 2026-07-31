import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePrayerScheduleRules1785542400000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "prayer_schedule_rules" (
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "type" CHARACTER VARYING NOT NULL,
        "targetLeadType" CHARACTER VARYING,
        "value" INTEGER NOT NULL,
        "description" CHARACTER VARYING NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        CONSTRAINT "PK_prayer_schedule_rules" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "prayer_schedule_rules" ("type", "targetLeadType", "value", "description") VALUES
        ('ROLE_FREQUENCY', NULL, 1, 'Default: every worker prays once per month'),
        ('ROLE_FREQUENCY', 'HOD', 2, 'HOD prays twice per month'),
        ('ROLE_FREQUENCY', 'D. HOD', 2, 'Deputy HOD prays twice per month'),
        ('MIN_LEADERS_PER_MEETING', NULL, 1, 'At least 1 HOD or Deputy HOD per prayer meeting'),
        ('MAX_PER_MEETING', NULL, 5, 'Maximum workers per prayer meeting')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "prayer_schedule_rules"`);
  }
}
