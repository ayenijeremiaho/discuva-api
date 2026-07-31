import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSmallGroupPaginationIndexes1790467200000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_small_group_attendance_group_id_meeting_date"
      ON small_group_attendance (group_id, meeting_date DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_small_group_members_group_id_created_at"
      ON small_group_members (group_id, created_at ASC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_small_group_members_group_id_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_small_group_attendance_group_id_meeting_date"`,
    );
  }
}
