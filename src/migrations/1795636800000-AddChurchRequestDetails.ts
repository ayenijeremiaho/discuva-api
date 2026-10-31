import { MigrationInterface, QueryRunner } from 'typeorm';

// What a new church, ministry or group tells us when asking to join, and the indexes behind the duplicate check.
export class AddChurchRequestDetails1795636800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tenants
         ADD COLUMN IF NOT EXISTS org_type character varying NOT NULL DEFAULT 'CHURCH',
         ADD COLUMN IF NOT EXISTS request_details jsonb`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tenants_lower_name" ON tenants (lower(name))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tenants_contact_domain"
         ON tenants ((request_details->>'contactDomain'))
         WHERE request_details->>'contactDomain' IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tenants_contact_domain"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tenants_lower_name"`);
    await queryRunner.query(
      `ALTER TABLE tenants DROP COLUMN IF EXISTS request_details, DROP COLUMN IF EXISTS org_type`,
    );
  }
}
