import { MigrationInterface, QueryRunner } from 'typeorm';

// Replaced by event_config.check_distance (1802764800000); no code has read or written these since that release.
export class DropEnforceMemberLocation1802851200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE event_config DROP COLUMN IF EXISTS enforce_member_location`,
    );
    await queryRunner.query(
      `ALTER TABLE service_slots DROP COLUMN IF EXISTS enforce_member_location_override`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE event_config ADD COLUMN IF NOT EXISTS enforce_member_location BOOLEAN NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE service_slots ADD COLUMN IF NOT EXISTS enforce_member_location_override BOOLEAN`,
    );
  }
}
