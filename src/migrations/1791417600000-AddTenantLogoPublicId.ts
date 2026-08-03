import { MigrationInterface, QueryRunner } from 'typeorm';

// Control-plane change — `tenants` lives in `public`, never a `search_path`
// target. Mirrors Member.photoPublicId: needed to delete the previous
// Cloudinary asset when a tenant replaces their logo, and to delete it
// outright via DELETE /tenant/logo — logoUrl alone isn't enough to identify
// the asset to Cloudinary's destroy API.
export class AddTenantLogoPublicId1791417600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants
      ADD COLUMN IF NOT EXISTS logo_public_id VARCHAR NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants
      DROP COLUMN IF EXISTS logo_public_id
    `);
  }
}
