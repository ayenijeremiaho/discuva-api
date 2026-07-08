import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFollowUpEnhancements1786579200000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE follow_up_notes ADD COLUMN contact_method VARCHAR`,
    );
    await queryRunner.query(
      `ALTER TABLE follow_up_tasks ADD COLUMN last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE follow_up_tasks DROP COLUMN last_activity_at`,
    );
    await queryRunner.query(
      `ALTER TABLE follow_up_notes DROP COLUMN contact_method`,
    );
  }
}
