import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendAssetManagement1783382400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE assets
                DROP COLUMN IF EXISTS total_units,
                DROP COLUMN IF EXISTS available_units,
                ADD COLUMN IF NOT EXISTS serial_number VARCHAR,
                ADD COLUMN IF NOT EXISTS manufacturer VARCHAR,
                ADD COLUMN IF NOT EXISTS model VARCHAR,
                ADD COLUMN IF NOT EXISTS warranty_expiry DATE,
                ADD COLUMN IF NOT EXISTS vendor_name VARCHAR,
                ADD COLUMN IF NOT EXISTS vendor_contact VARCHAR,
                ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
                ADD COLUMN IF NOT EXISTS in_storage INTEGER,
                ADD COLUMN IF NOT EXISTS in_use INTEGER,
                ADD COLUMN IF NOT EXISTS under_repair INTEGER,
                ADD COLUMN IF NOT EXISTS written_off INTEGER,
                ADD COLUMN IF NOT EXISTS warranty_notified_30_days_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS warranty_notified_14_days_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS warranty_notified_7_days_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS warranty_notified_1_day_at TIMESTAMPTZ
        `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_assets_department ON assets(department_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_assets_warranty_expiry ON assets(warranty_expiry) WHERE warranty_expiry IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_assets_warranty_expiry`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_assets_department`);

    await queryRunner.query(`
            ALTER TABLE assets
                DROP COLUMN IF EXISTS warranty_notified_1_day_at,
                DROP COLUMN IF EXISTS warranty_notified_7_days_at,
                DROP COLUMN IF EXISTS warranty_notified_14_days_at,
                DROP COLUMN IF EXISTS warranty_notified_30_days_at,
                DROP COLUMN IF EXISTS written_off,
                DROP COLUMN IF EXISTS under_repair,
                DROP COLUMN IF EXISTS in_use,
                DROP COLUMN IF EXISTS in_storage,
                DROP COLUMN IF EXISTS department_id,
                DROP COLUMN IF EXISTS vendor_contact,
                DROP COLUMN IF EXISTS vendor_name,
                DROP COLUMN IF EXISTS warranty_expiry,
                DROP COLUMN IF EXISTS model,
                DROP COLUMN IF EXISTS manufacturer,
                DROP COLUMN IF EXISTS serial_number,
                ADD COLUMN IF NOT EXISTS total_units INTEGER,
                ADD COLUMN IF NOT EXISTS available_units INTEGER
        `);
  }
}
