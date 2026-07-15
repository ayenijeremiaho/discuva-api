import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGroupsModule1787443200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "groups" (
        "created_at"  TIMESTAMPTZ       NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMPTZ       NOT NULL DEFAULT now(),
        "id"          uuid              NOT NULL DEFAULT gen_random_uuid(),
        "name"        character varying NOT NULL,
        "description" text,
        "created_by"  uuid,
        CONSTRAINT "PK_groups" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_groups_name" UNIQUE ("name")
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "groups" ADD CONSTRAINT "FK_groups_created_by" FOREIGN KEY ("created_by") REFERENCES "members"("id") ON DELETE SET NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "group_members" (
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "id"         uuid        NOT NULL DEFAULT gen_random_uuid(),
        "group_id"   uuid        NOT NULL,
        "member_id"  uuid        NOT NULL,
        "added_by"   uuid,
        CONSTRAINT "PK_group_members" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_group_members_group_id_member_id" UNIQUE ("group_id", "member_id")
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "group_members" ADD CONSTRAINT "FK_group_members_group_id" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "group_members" ADD CONSTRAINT "FK_group_members_member_id" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "group_members" ADD CONSTRAINT "FK_group_members_added_by" FOREIGN KEY ("added_by") REFERENCES "members"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_group_members_group_id" ON "group_members" ("group_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_group_members_member_id" ON "group_members" ("member_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "announcements" ADD COLUMN "group_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "announcements" ADD CONSTRAINT "FK_announcements_group_id" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_announcements_group_id" ON "announcements" ("group_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_announcements_group_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "announcements" DROP CONSTRAINT IF EXISTS "FK_announcements_group_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "announcements" DROP COLUMN IF EXISTS "group_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "group_members"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "groups"`);
  }
}
