import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 4: a copy of every networked church's upcoming events (for the agenda, and the ones shared with branches),
// and which branches hid a shared one.
export class AddNetworkEvents1807123200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS network_events (
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        event_id uuid NOT NULL,
        network_root_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name character varying NOT NULL,
        description character varying(1000) NULL,
        start_time timestamptz NOT NULL,
        end_time timestamptz NOT NULL,
        audience character varying NOT NULL,
        venue_name character varying NULL,
        service_count integer NOT NULL DEFAULT 1,
        shared boolean NOT NULL DEFAULT false,
        PRIMARY KEY (tenant_id, event_id)
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_network_events_root_start ON network_events (network_root_id, start_time)`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS network_event_hides (
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        source_tenant_id uuid NOT NULL,
        event_id uuid NOT NULL,
        PRIMARY KEY (tenant_id, source_tenant_id, event_id)
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS network_event_hides`);
    await queryRunner.query(`DROP TABLE IF EXISTS network_events`);
  }
}
