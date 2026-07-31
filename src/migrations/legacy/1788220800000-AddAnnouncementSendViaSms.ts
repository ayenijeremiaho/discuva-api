import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnnouncementSendViaSms1788220800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS send_via_sms BOOLEAN NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS sms_body TEXT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE announcements DROP COLUMN IF EXISTS sms_body`,
    );
    await queryRunner.query(
      `ALTER TABLE announcements DROP COLUMN IF EXISTS send_via_sms`,
    );
  }
}
