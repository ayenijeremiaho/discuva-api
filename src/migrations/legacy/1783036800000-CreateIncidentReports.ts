import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIncidentReports1783036800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS incident_reports (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                title VARCHAR NOT NULL,
                description TEXT NOT NULL,
                images TEXT,
                location VARCHAR,
                status VARCHAR NOT NULL DEFAULT 'OPEN',
                is_anonymous BOOLEAN NOT NULL DEFAULT false,
                admin_notes TEXT,
                resolved_at TIMESTAMPTZ,
                reporter_id UUID REFERENCES members(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_incident_reports_status ON incident_reports (status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_incident_reports_reporter ON incident_reports (reporter_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS incident_reports`);
  }
}
