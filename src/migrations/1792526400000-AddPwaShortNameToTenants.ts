import { MigrationInterface, QueryRunner } from 'typeorm';

// Control-plane change — `tenants` lives in `public`, never a `search_path`
// target. VARCHAR(20) matches UpdateTenantProfileDto's @MaxLength(20) — a
// home-screen label only survives ~10-13 characters before truncation on
// both iOS and Android, so this is deliberately much shorter than name's
// implicit unbounded length.
export class AddPwaShortNameToTenants1792526400000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants
      ADD COLUMN IF NOT EXISTS pwa_short_name VARCHAR(20)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants
      DROP COLUMN IF EXISTS pwa_short_name
    `);
  }
}
