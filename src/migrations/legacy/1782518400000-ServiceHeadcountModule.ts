import { MigrationInterface, QueryRunner } from 'typeorm';

export class ServiceHeadcountModule1782518400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "service_headcounts" (
                "id"              uuid                     NOT NULL DEFAULT uuid_generate_v4(),
                "created_at"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "male_adults"     integer                  NOT NULL DEFAULT 0,
                "female_adults"   integer                  NOT NULL DEFAULT 0,
                "teenagers"       integer                  NOT NULL DEFAULT 0,
                "children"        integer                  NOT NULL DEFAULT 0,
                "mobile_church"   integer                  NOT NULL DEFAULT 0,
                "custom_groups"   jsonb                    NOT NULL DEFAULT '{}',
                "notes"           text,
                "service_slot_id" uuid                     NOT NULL,
                "recorded_by_id"  uuid,
                CONSTRAINT "pk_service_headcounts" PRIMARY KEY ("id"),
                CONSTRAINT "fk_headcount_service_slot" FOREIGN KEY ("service_slot_id")
                    REFERENCES "service_slots" ("id") ON DELETE CASCADE,
                CONSTRAINT "fk_headcount_recorded_by" FOREIGN KEY ("recorded_by_id")
                    REFERENCES "admins" ("id") ON DELETE SET NULL
            )
        `);

    await queryRunner.query(
      `CREATE INDEX "idx_headcount_service_slot" ON "service_headcounts" ("service_slot_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_headcount_service_slot"`);
    await queryRunner.query(`DROP TABLE "service_headcounts"`);
  }
}
