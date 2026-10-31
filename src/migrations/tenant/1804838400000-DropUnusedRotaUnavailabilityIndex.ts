import { MigrationInterface, QueryRunner } from 'typeorm';

// Every lookup has the member, which the unique (member_id, date) index already serves.
export class DropUnusedRotaUnavailabilityIndex1804838400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_rota_unavailability_date_member"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_rota_unavailability_date_member" ON rota_unavailability (date, member_id)`,
    );
  }
}
