import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRotaDraftsAndCustomCover1804752000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE rota_drafts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        service_slot_id uuid REFERENCES service_slots(id) ON DELETE CASCADE,
        schedule_id uuid REFERENCES rota_schedules(id) ON DELETE CASCADE,
        occurrence_date date,
        entries jsonb NOT NULL DEFAULT '[]',
        updated_by_id uuid REFERENCES members(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_rota_drafts_target" CHECK (
          (service_slot_id IS NOT NULL AND schedule_id IS NULL AND occurrence_date IS NULL) OR
          (service_slot_id IS NULL AND schedule_id IS NOT NULL AND occurrence_date IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_rota_drafts_slot" ON rota_drafts (department_id, service_slot_id) WHERE service_slot_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_rota_drafts_session" ON rota_drafts (schedule_id, occurrence_date) WHERE schedule_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rota_drafts_department" ON rota_drafts (department_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rota_drafts_updated_by" ON rota_drafts (updated_by_id)`,
    );

    await queryRunner.query(
      `ALTER TABLE rota_custom_assignments ALTER COLUMN role DROP NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE rota_cover_requests ALTER COLUMN assignment_id DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE rota_cover_requests ADD COLUMN custom_assignment_id uuid REFERENCES rota_custom_assignments(id) ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE rota_cover_requests ADD CONSTRAINT "CHK_rota_cover_requests_duty" CHECK ((assignment_id IS NULL) <> (custom_assignment_id IS NULL))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rota_cover_requests_custom_assignment" ON rota_cover_requests (custom_assignment_id) WHERE custom_assignment_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM rota_cover_requests WHERE custom_assignment_id IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE rota_cover_requests DROP CONSTRAINT "CHK_rota_cover_requests_duty"`,
    );
    await queryRunner.query(
      `ALTER TABLE rota_cover_requests DROP COLUMN custom_assignment_id`,
    );
    await queryRunner.query(
      `ALTER TABLE rota_cover_requests ALTER COLUMN assignment_id SET NOT NULL`,
    );
    await queryRunner.query(
      `UPDATE rota_custom_assignments SET role = '' WHERE role IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE rota_custom_assignments ALTER COLUMN role SET NOT NULL`,
    );
    await queryRunner.query(`DROP TABLE rota_drafts`);
  }
}
