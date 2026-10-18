import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAttendanceCheckedInBy1803196800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE attendances ADD COLUMN IF NOT EXISTS checked_in_by_id UUID NULL REFERENCES members(id) ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_attendances_checked_in_by_id" ON attendances(checked_in_by_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_attendances_checked_in_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE attendances DROP COLUMN IF EXISTS checked_in_by_id`,
    );
  }
}
