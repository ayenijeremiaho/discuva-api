import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePrayerFixedAssignments1785628800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "prayer_fixed_assignments" (
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "worker_profile_id" UUID NOT NULL,
        "day_config_id" UUID NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        CONSTRAINT "PK_prayer_fixed_assignments" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_prayer_fixed_assignment_worker_day" UNIQUE ("worker_profile_id", "day_config_id"),
        CONSTRAINT "FK_prayer_fixed_assignment_worker" FOREIGN KEY ("worker_profile_id") REFERENCES "worker_profiles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_prayer_fixed_assignment_day" FOREIGN KEY ("day_config_id") REFERENCES "prayer_day_configs"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_fixed_assignment_worker" ON "prayer_fixed_assignments" ("worker_profile_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "prayer_fixed_assignments"`);
  }
}
