import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEventThankYouSentAt1786406400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE events ADD COLUMN thank_you_sent_at TIMESTAMPTZ`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE events DROP COLUMN thank_you_sent_at`);
  }
}
