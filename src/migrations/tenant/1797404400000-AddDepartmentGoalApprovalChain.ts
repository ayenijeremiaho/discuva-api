import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDepartmentGoalApprovalChain1797404400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE department_goal_cycles ADD approval_chain jsonb
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE department_goal_cycles DROP COLUMN approval_chain
    `);
  }
}
