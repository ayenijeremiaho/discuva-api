import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCreatedByAdminToDepartmentGoals1798354800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE department_goals ADD created_by_admin_id UUID
        `);
    await queryRunner.query(`
            ALTER TABLE department_goals
            ADD CONSTRAINT "FK_department_goals_created_by_admin_id"
            FOREIGN KEY (created_by_admin_id) REFERENCES admins (id) ON DELETE SET NULL
        `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE department_goals DROP CONSTRAINT "FK_department_goals_created_by_admin_id"
        `);
    await queryRunner.query(`
            ALTER TABLE department_goals DROP COLUMN created_by_admin_id
        `);
  }
}
