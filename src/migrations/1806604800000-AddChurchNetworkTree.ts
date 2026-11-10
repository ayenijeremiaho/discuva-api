import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 4: networks are a tree of churches under one top church, with stable addresses,
// optional level names and a log of moves. The old invite and link-request flows go.
export class AddChurchNetworkTree1806604800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS network_root_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS network_label character varying(40)`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tenants_network_root ON tenants (network_root_id, parent_tenant_id) WHERE network_root_id IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS network_levels (
        network_root_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        depth smallint NOT NULL,
        name character varying(40) NOT NULL,
        PRIMARY KEY (network_root_id, depth)
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS network_moves (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        network_root_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        from_parent_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
        to_parent_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
        moved_by_tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
        moved_by_member_id uuid,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_network_moves_root ON network_moves (network_root_id, created_at DESC)`,
    );

    // Production has no network links; drop only if that's still true, so nothing is ever lost.
    for (const table of [
      'tenant_branch_link_requests',
      'tenant_branch_invites',
    ]) {
      const [{ exists }] = await queryRunner.query(
        `SELECT to_regclass($1) IS NOT NULL AS exists`,
        [table],
      );
      if (!exists) continue;
      const [{ n }] = await queryRunner.query(
        `SELECT count(*)::int AS n FROM ${table}`,
      );
      if (n === 0) await queryRunner.query(`DROP TABLE ${table}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS network_moves`);
    await queryRunner.query(`DROP TABLE IF EXISTS network_levels`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_tenants_network_root`);
    await queryRunner.query(
      `ALTER TABLE tenants DROP COLUMN IF EXISTS network_label, DROP COLUMN IF EXISTS network_root_id`,
    );
  }
}
