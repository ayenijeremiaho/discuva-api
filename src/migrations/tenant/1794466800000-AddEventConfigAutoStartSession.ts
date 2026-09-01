import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEventConfigAutoStartSession1794466800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE event_config
        ADD auto_start_session BOOLEAN NOT NULL DEFAULT false
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE event_config DROP COLUMN auto_start_session
    `);
  }
}
