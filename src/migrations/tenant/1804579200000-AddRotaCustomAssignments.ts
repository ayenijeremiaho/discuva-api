import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRotaCustomAssignments1804579200000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE rota_custom_assignments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        schedule_id uuid NOT NULL REFERENCES rota_schedules(id) ON DELETE CASCADE,
        occurrence_date date NOT NULL,
        member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        responsibility_id uuid REFERENCES rota_responsibilities(id) ON DELETE SET NULL,
        role varchar(100) NOT NULL,
        assigned_by_id uuid REFERENCES members(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_rota_custom_assignments_schedule_date_member" UNIQUE (schedule_id, occurrence_date, member_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_rota_custom_assignments_schedule_date" ON rota_custom_assignments (schedule_id, occurrence_date)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rota_custom_assignments_member_date" ON rota_custom_assignments (member_id, occurrence_date)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rota_custom_assignments_responsibility" ON rota_custom_assignments (responsibility_id) WHERE responsibility_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rota_custom_assignments_assigned_by" ON rota_custom_assignments (assigned_by_id) WHERE assigned_by_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE rota_custom_assignments`);
  }
}
