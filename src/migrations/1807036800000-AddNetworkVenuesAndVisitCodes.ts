import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 4: each branch's venues copied up (already public) so the app can tell which branch someone is at,
// and each branch's venue code for checking in as a visitor without location.
export class AddNetworkVenuesAndVisitCodes1807036800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS network_venues (
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        venue_id uuid NOT NULL,
        network_root_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name character varying NOT NULL,
        latitude double precision NOT NULL,
        longitude double precision NOT NULL,
        PRIMARY KEY (tenant_id, venue_id)
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_network_venues_root ON network_venues (network_root_id)`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS network_visit_codes (
        tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        code character varying(8) NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    // Churches already in a network: copy their venues once; later changes are copied by VenueService.
    await queryRunner.query(`
      DO $$
      DECLARE t record;
      BEGIN
        FOR t IN SELECT id, schema_name, network_root_id FROM tenants
                 WHERE network_root_id IS NOT NULL AND schema_name IS NOT NULL LOOP
          IF EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema = t.schema_name AND table_name = 'venues') THEN
            EXECUTE format(
              'INSERT INTO network_venues (tenant_id, venue_id, network_root_id, name, latitude, longitude)
               SELECT $1, v.id, $2, v.name, v.latitude, v.longitude FROM %I.venues v
               ON CONFLICT DO NOTHING', t.schema_name)
            USING t.id, t.network_root_id;
          END IF;
        END LOOP;
      END $$`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS network_visit_codes`);
    await queryRunner.query(`DROP TABLE IF EXISTS network_venues`);
  }
}
