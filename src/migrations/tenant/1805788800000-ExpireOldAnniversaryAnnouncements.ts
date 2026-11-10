import { MigrationInterface, QueryRunner } from 'typeorm';

// Anniversary posts were saved without an expiry; end each one at the close of the day it went out, church time.
export class ExpireOldAnniversaryAnnouncements1805788800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const tz = process.env.TIMEZONE || 'Africa/Lagos';
    await queryRunner.query(
      `UPDATE announcements
          SET expires_at = ((date_trunc('day', published_at AT TIME ZONE $1) + interval '1 day' - interval '1 millisecond') AT TIME ZONE $1)
        WHERE author_id IS NULL
          AND expires_at IS NULL
          AND published_at IS NOT NULL
          AND title LIKE 'Celebrating % years with %!'`,
      [tz],
    );
  }

  public async down(): Promise<void> {}
}
