import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeFollowUpTaskAssignedToNullable1798614000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE follow_up_tasks DROP CONSTRAINT follow_up_tasks_assigned_to_id_fkey
    `);
    await queryRunner.query(`
      ALTER TABLE follow_up_tasks ALTER COLUMN assigned_to_id DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE follow_up_tasks
      ADD CONSTRAINT follow_up_tasks_assigned_to_id_fkey
      FOREIGN KEY (assigned_to_id) REFERENCES worker_profiles(id) ON DELETE SET NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE follow_up_tasks DROP CONSTRAINT follow_up_tasks_assigned_to_id_fkey
    `);
    await queryRunner.query(`
      ALTER TABLE follow_up_tasks ALTER COLUMN assigned_to_id SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE follow_up_tasks
      ADD CONSTRAINT follow_up_tasks_assigned_to_id_fkey
      FOREIGN KEY (assigned_to_id) REFERENCES worker_profiles(id) ON DELETE RESTRICT
    `);
  }
}
