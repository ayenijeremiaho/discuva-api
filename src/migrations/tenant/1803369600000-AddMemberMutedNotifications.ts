import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMemberMutedNotifications1803369600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE members ADD COLUMN IF NOT EXISTS muted_notifications character varying[] NOT NULL DEFAULT '{}'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE members DROP COLUMN IF EXISTS muted_notifications`,
    );
  }
}
