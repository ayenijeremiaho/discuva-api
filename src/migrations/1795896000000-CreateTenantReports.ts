import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTenantReports1795896000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tenant_reports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        reason character varying(1000) NOT NULL,
        reporter_email character varying,
        reviewed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_tenant_reports_open" ON tenant_reports (created_at DESC) WHERE reviewed_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tenant_reports_tenant_id" ON tenant_reports (tenant_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE tenant_reports`);
  }
}
