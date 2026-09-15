import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDepartmentGoalApprovalTables1797490800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE department_goal_approvals (
        id             UUID          NOT NULL DEFAULT gen_random_uuid(),
        cycle_id       UUID          NOT NULL,
        department_id  UUID          NOT NULL,
        current_level  SMALLINT      NOT NULL DEFAULT 1,
        status         VARCHAR       NOT NULL DEFAULT 'PENDING',
        completed_at   TIMESTAMPTZ,
        created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_department_goal_approvals" PRIMARY KEY (id),
        CONSTRAINT "FK_department_goal_approvals_cycle_id" FOREIGN KEY (cycle_id) REFERENCES department_goal_cycles (id) ON DELETE CASCADE,
        CONSTRAINT "FK_department_goal_approvals_department_id" FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE RESTRICT,
        CONSTRAINT "UQ_department_goal_approvals_cycle_id_department_id" UNIQUE (cycle_id, department_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_department_goal_approvals_department_id" ON department_goal_approvals (department_id)
    `);

    await queryRunner.query(`
      CREATE TABLE department_goal_comments (
        id                  UUID        NOT NULL DEFAULT gen_random_uuid(),
        cycle_id            UUID        NOT NULL,
        department_id       UUID        NOT NULL,
        posted_by_admin_id  UUID,
        content             TEXT        NOT NULL,
        approval_level      SMALLINT,
        decision            VARCHAR,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_department_goal_comments" PRIMARY KEY (id),
        CONSTRAINT "FK_department_goal_comments_cycle_id" FOREIGN KEY (cycle_id) REFERENCES department_goal_cycles (id) ON DELETE CASCADE,
        CONSTRAINT "FK_department_goal_comments_department_id" FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE RESTRICT,
        CONSTRAINT "FK_department_goal_comments_posted_by_admin_id" FOREIGN KEY (posted_by_admin_id) REFERENCES admins (id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_department_goal_comments_cycle_id_department_id" ON department_goal_comments (cycle_id, department_id)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_department_goal_comments_department_id" ON department_goal_comments (department_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE department_goal_comments`);
    await queryRunner.query(`DROP TABLE department_goal_approvals`);
  }
}
