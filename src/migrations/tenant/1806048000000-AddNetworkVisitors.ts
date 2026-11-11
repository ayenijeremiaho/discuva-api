import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 4: visitors from other branches of the network (host side), and "attended at another branch" (home side).
export class AddNetworkVisitors1806048000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS network_visitors (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        service_slot_id uuid NULL REFERENCES service_slots(id) ON DELETE SET NULL,
        account_id uuid NOT NULL,
        from_tenant_id uuid NOT NULL,
        firstname character varying NOT NULL,
        lastname character varying NOT NULL,
        photo_url character varying NULL,
        checkin_time timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_network_visitors_event_account UNIQUE (event_id, account_id)
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_network_visitors_account_time ON network_visitors (account_id, checkin_time)`,
    );
    await queryRunner.query(
      `ALTER TABLE attendances ADD COLUMN IF NOT EXISTS attended_at_tenant_id uuid NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE attendances DROP COLUMN IF EXISTS attended_at_tenant_id`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS network_visitors`);
  }
}
