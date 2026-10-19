import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateServingRota1803715200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS rota_assignments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        service_slot_id uuid NOT NULL REFERENCES service_slots(id) ON DELETE CASCADE,
        member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        role character varying(80),
        assigned_by_id uuid REFERENCES members(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_rota_assignments_slot_dept_member" UNIQUE (service_slot_id, department_id, member_id)
      )`);
    // A member's own duties, and a department's rota across services.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_rota_assignments_member_id" ON rota_assignments (member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_rota_assignments_department_slot" ON rota_assignments (department_id, service_slot_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_rota_assignments_assigned_by_id" ON rota_assignments (assigned_by_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS rota_cover_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        assignment_id uuid NOT NULL REFERENCES rota_assignments(id) ON DELETE CASCADE,
        department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        requested_by_id uuid REFERENCES members(id) ON DELETE SET NULL,
        target_member_id uuid REFERENCES members(id) ON DELETE SET NULL,
        reason character varying(300),
        status character varying NOT NULL DEFAULT 'OPEN',
        accepted_by_id uuid REFERENCES members(id) ON DELETE SET NULL,
        resolved_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    // Only one open request per duty.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_rota_cover_requests_open_assignment" ON rota_cover_requests (assignment_id) WHERE status = 'OPEN'`,
    );
    // Open requests a department's workers can take.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_rota_cover_requests_open_department" ON rota_cover_requests (department_id) WHERE status = 'OPEN'`,
    );
    for (const col of ['requested_by_id', 'target_member_id', 'accepted_by_id'])
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS "IDX_rota_cover_requests_${col}" ON rota_cover_requests (${col})`,
      );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS rota_cover_requests`);
    await queryRunner.query(`DROP TABLE IF EXISTS rota_assignments`);
  }
}
