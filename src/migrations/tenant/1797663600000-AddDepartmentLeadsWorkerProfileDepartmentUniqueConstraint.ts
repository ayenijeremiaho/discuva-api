import { MigrationInterface, QueryRunner } from 'typeorm';

// Closes the gap left by the previous migration
// (1797577200000-DropDepartmentLeadsWorkerProfileUniqueConstraint): removing
// the old UNIQUE(worker_profile_id) correctly allowed a worker to lead
// multiple DIFFERENT departments, but it also removed the only thing
// stopping the same worker being assigned as BOTH HOD and Deputy HOD of the
// SAME department — a combination that should never be valid, since the
// two roles are meant to be different people.
//
// NOTE: if any tenant already has such a duplicate (same worker_profile_id
// + department_id across two rows with different lead_type), this
// migration will fail for that tenant until the duplicate is resolved
// manually — deliberately not auto-resolved here, since deciding which of
// the two role assignments to keep is a judgment call, not something to
// silently guess in a migration.
export class AddDepartmentLeadsWorkerProfileDepartmentUniqueConstraint1797663600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE department_leads ADD CONSTRAINT "UQ_department_leads_department_id_worker_profile_id" UNIQUE (department_id, worker_profile_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE department_leads DROP CONSTRAINT "UQ_department_leads_department_id_worker_profile_id"
    `);
  }
}
