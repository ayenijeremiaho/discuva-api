import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddServiceSessionAccessGrantUniqueActiveName1787616000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Two active grants sharing a name make sign-in ambiguous (name+PIN
    // matches whichever row the lookup happens to find first) — guard this
    // at the DB level as well as in the service's own pre-check.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_service_session_access_grants_session_name_active"
      ON "service_session_access_grants" (session_id, lower(name))
      WHERE revoked_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_service_session_access_grants_session_name_active"`,
    );
  }
}
