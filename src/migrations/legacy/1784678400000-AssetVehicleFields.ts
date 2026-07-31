import { MigrationInterface, QueryRunner } from 'typeorm';

export class AssetVehicleFields1784678400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE assets ADD COLUMN IF NOT EXISTS insurance_expiry DATE`,
    );
    await queryRunner.query(
      `ALTER TABLE assets ADD COLUMN IF NOT EXISTS roadworthiness_expiry DATE`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_asset_insurance_expiry ON assets(insurance_expiry) WHERE insurance_expiry IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_asset_roadworthiness_expiry ON assets(roadworthiness_expiry) WHERE roadworthiness_expiry IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_asset_roadworthiness_expiry`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_asset_insurance_expiry`);
    await queryRunner.query(
      `ALTER TABLE assets DROP COLUMN IF EXISTS roadworthiness_expiry`,
    );
    await queryRunner.query(
      `ALTER TABLE assets DROP COLUMN IF EXISTS insurance_expiry`,
    );
  }
}
