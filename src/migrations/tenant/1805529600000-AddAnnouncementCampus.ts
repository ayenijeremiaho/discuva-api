import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnnouncementCampus1805529600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE announcements ADD COLUMN campus_id uuid REFERENCES campuses(id) ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_announcements_campus_id" ON announcements (campus_id) WHERE campus_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_announcements_campus_id"`);
    await queryRunner.query(`ALTER TABLE announcements DROP COLUMN campus_id`);
  }
}
