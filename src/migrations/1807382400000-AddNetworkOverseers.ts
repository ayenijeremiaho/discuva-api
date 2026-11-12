import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 4: up to 5 admins of a network's top church who can look inside every branch, read-only.
export class AddNetworkOverseers1807382400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS network_overseers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        network_root_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        member_id uuid NOT NULL,
        name character varying NOT NULL,
        email character varying NOT NULL,
        added_by_name character varying NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_network_overseers_member ON network_overseers (network_root_id, member_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS network_overseers`);
  }
}
