import { MigrationInterface, QueryRunner } from 'typeorm';

// Per-config "Check distance for these services". On by default, so every existing config keeps today's behaviour.
// Replaces enforce_member_location, which the code no longer reads (its column is dropped in a later release).
export class AddEventConfigCheckDistance1802764800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE event_configs ADD COLUMN IF NOT EXISTS check_distance BOOLEAN NOT NULL DEFAULT true`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE event_configs DROP COLUMN IF EXISTS check_distance`,
    );
  }
}
