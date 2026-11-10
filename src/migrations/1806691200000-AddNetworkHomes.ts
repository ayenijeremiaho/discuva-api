import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 4: each Discuva account's home branch in each network it belongs to.
export class AddNetworkHomes1806691200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS network_homes (
        account_id uuid NOT NULL REFERENCES discuva_accounts(id) ON DELETE CASCADE,
        network_root_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        home_tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, network_root_id)
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_network_homes_home ON network_homes (home_tenant_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS network_homes`);
  }
}
