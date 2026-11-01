import { MigrationInterface, QueryRunner } from 'typeorm';

// Most members mute nothing, so the control centre's count reads only those who do.
export class AddMemberMutedNotificationsIndex1805184000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_members_muted_notifications" ON members (status) WHERE cardinality(muted_notifications) > 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_members_muted_notifications"`,
    );
  }
}
