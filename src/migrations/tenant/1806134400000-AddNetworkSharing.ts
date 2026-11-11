import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 4: announcements and events a church sends to every branch under it, and the branch copies of announcements.
export class AddNetworkSharing1806134400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE announcements
        ADD COLUMN IF NOT EXISTS send_to_branches boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS network_source_id uuid NULL,
        ADD COLUMN IF NOT EXISTS network_source_tenant_id uuid NULL,
        ADD COLUMN IF NOT EXISTS network_from character varying(300) NULL,
        ADD COLUMN IF NOT EXISTS network_hidden boolean NOT NULL DEFAULT false`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_announcements_network_source ON announcements (network_source_tenant_id, network_source_id) WHERE network_source_id IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE events ADD COLUMN IF NOT EXISTS send_to_branches boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE event_series ADD COLUMN IF NOT EXISTS send_to_branches boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE event_series DROP COLUMN IF EXISTS send_to_branches`,
    );
    await queryRunner.query(
      `ALTER TABLE events DROP COLUMN IF EXISTS send_to_branches`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_announcements_network_source`,
    );
    await queryRunner.query(`
      ALTER TABLE announcements
        DROP COLUMN IF EXISTS network_hidden,
        DROP COLUMN IF EXISTS network_from,
        DROP COLUMN IF EXISTS network_source_tenant_id,
        DROP COLUMN IF EXISTS network_source_id,
        DROP COLUMN IF EXISTS send_to_branches`);
  }
}
