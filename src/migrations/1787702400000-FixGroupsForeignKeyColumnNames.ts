import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddGroupsModule created these FK columns as "created_by"/"added_by", but
 * the Group/GroupMember entities have no explicit @JoinColumn, so
 * SnakeNamingStrategy.joinColumnName expects "created_by_id"/"added_by_id" at
 * runtime. This mismatch causes `column grp.created_by_id does not exist`
 * whenever the relation is selected (e.g. announcements list with a group).
 */
export class FixGroupsForeignKeyColumnNames1787702400000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE groups RENAME COLUMN created_by TO created_by_id`,
    );
    await queryRunner.query(
      `ALTER TABLE group_members RENAME COLUMN added_by TO added_by_id`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE group_members RENAME COLUMN added_by_id TO added_by`,
    );
    await queryRunner.query(
      `ALTER TABLE groups RENAME COLUMN created_by_id TO created_by`,
    );
  }
}
