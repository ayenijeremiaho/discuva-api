import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAssetManagement1783123200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS assets (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tag_number VARCHAR NOT NULL,
                name VARCHAR NOT NULL,
                description TEXT,
                category VARCHAR NOT NULL,
                location VARCHAR,
                status VARCHAR NOT NULL DEFAULT 'ACTIVE',
                purchase_date DATE,
                purchase_value DECIMAL(15, 2),
                maintenance_enabled BOOLEAN NOT NULL DEFAULT false,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                CONSTRAINT uq_assets_tag_number UNIQUE (tag_number)
            )
        `);

    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS asset_maintenance_schedules (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
                frequency_unit VARCHAR NOT NULL,
                frequency_value INT NOT NULL,
                last_maintained_at DATE,
                next_due_at DATE NOT NULL,
                notified_7_days_at TIMESTAMPTZ,
                notified_3_days_at TIMESTAMPTZ,
                notified_1_day_at TIMESTAMPTZ,
                notified_due_day_at TIMESTAMPTZ,
                last_overdue_notified_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                CONSTRAINT uq_asset_schedule_asset_id UNIQUE (asset_id)
            )
        `);

    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS asset_maintenance_records (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
                type VARCHAR NOT NULL,
                performed_at DATE NOT NULL,
                performed_by VARCHAR NOT NULL,
                cost DECIMAL(15, 2),
                notes TEXT NOT NULL,
                attachments TEXT,
                condition_after VARCHAR NOT NULL,
                completion_status VARCHAR NOT NULL,
                logged_by_id UUID NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_assets_status ON assets (status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_asset_schedules_next_due ON asset_maintenance_schedules (next_due_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_maintenance_records_asset ON asset_maintenance_records (asset_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS asset_maintenance_records`);
    await queryRunner.query(`DROP TABLE IF EXISTS asset_maintenance_schedules`);
    await queryRunner.query(`DROP TABLE IF EXISTS assets`);
  }
}
