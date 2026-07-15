import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddServiceSessionAccessGrant1787529600000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "service_session_access_grants" (
        "created_at"           TIMESTAMPTZ       NOT NULL DEFAULT now(),
        "updated_at"           TIMESTAMPTZ       NOT NULL DEFAULT now(),
        "id"                   uuid              NOT NULL DEFAULT gen_random_uuid(),
        "session_id"           uuid              NOT NULL,
        "name"                 character varying NOT NULL,
        "pin_hash"             character varying NOT NULL,
        "granted_by_member_id" uuid,
        "revoked_at"           TIMESTAMPTZ,
        "last_used_at"         TIMESTAMPTZ,
        CONSTRAINT "PK_service_session_access_grants" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "service_session_access_grants" ADD CONSTRAINT "FK_service_session_access_grants_session_id" FOREIGN KEY ("session_id") REFERENCES "service_sessions"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "service_session_access_grants" ADD CONSTRAINT "FK_service_session_access_grants_granted_by_member_id" FOREIGN KEY ("granted_by_member_id") REFERENCES "members"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_service_session_access_grants_session_id" ON "service_session_access_grants" ("session_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "service_action_entries" ADD COLUMN "actor_label" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "service_action_entries" DROP COLUMN IF EXISTS "actor_label"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_service_session_access_grants_session_id"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "service_session_access_grants"`,
    );
  }
}
