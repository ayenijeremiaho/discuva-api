import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDepartmentGoalApprovalLevelOverrides1797750000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE department_goal_approvals ADD level_overrides jsonb
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE department_goal_approvals DROP COLUMN level_overrides
    `);
  }
}
