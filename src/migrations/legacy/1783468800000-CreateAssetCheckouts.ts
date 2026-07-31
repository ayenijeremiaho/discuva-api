import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAssetCheckouts1783468800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS asset_checkouts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
                checked_out_to_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
                checked_out_to_department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
                checked_out_at TIMESTAMPTZ NOT NULL,
                expected_return_at TIMESTAMPTZ,
                returned_at TIMESTAMPTZ,
                purpose VARCHAR,
                notes TEXT,
                checked_out_by_admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
                returned_by_admin_id UUID REFERENCES admins(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_asset_checkouts_asset ON asset_checkouts(asset_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_asset_checkouts_returned_at ON asset_checkouts(returned_at) WHERE returned_at IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_asset_checkouts_returned_at`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_asset_checkouts_asset`);
    await queryRunner.query(`DROP TABLE IF EXISTS asset_checkouts`);
  }
}
