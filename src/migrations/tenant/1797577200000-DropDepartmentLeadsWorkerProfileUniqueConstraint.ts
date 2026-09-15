import { MigrationInterface, QueryRunner } from 'typeorm';

// department_leads had a UNIQUE(worker_profile_id) constraint from the
// original schema, limiting a worker to leading at most ONE department
// total (any department, any lead type) — contradicting the application's
// intended design, where a worker can be HOD/Deputy-HOD of multiple
// departments (already assumed elsewhere, e.g.
// DepartmentService.getLeadRoles/assertIsDepartmentLead). The remaining
// UQ_department_leads_dept_leadtype constraint (department_id, lead_type)
// is unaffected and still correctly enforces one HOD and one Deputy-HOD
// per department.
export class DropDepartmentLeadsWorkerProfileUniqueConstraint1797577200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE department_leads DROP CONSTRAINT "UQ_department_leads_worker_profile_id"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE department_leads ADD CONSTRAINT "UQ_department_leads_worker_profile_id" UNIQUE (worker_profile_id)
    `);
  }
}
