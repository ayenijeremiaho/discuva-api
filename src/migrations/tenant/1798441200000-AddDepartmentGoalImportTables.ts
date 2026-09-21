import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDepartmentGoalImportTables1798441200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE department_goal_import_jobs (
                id                    UUID          NOT NULL DEFAULT gen_random_uuid(),
                cycle_id              UUID          NOT NULL,
                department_id         UUID          NOT NULL,
                original_filename     VARCHAR       NOT NULL,
                status                VARCHAR       NOT NULL DEFAULT 'READY_FOR_REVIEW',
                total_rows            INT           NOT NULL DEFAULT 0,
                valid_rows            INT           NOT NULL DEFAULT 0,
                created_count         INT           NOT NULL DEFAULT 0,
                failed_commit_count   INT           NOT NULL DEFAULT 0,
                created_by_id         UUID          NOT NULL,
                created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
                updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
                CONSTRAINT "PK_department_goal_import_jobs" PRIMARY KEY (id),
                CONSTRAINT "FK_department_goal_import_jobs_cycle_id" FOREIGN KEY (cycle_id) REFERENCES department_goal_cycles (id) ON DELETE CASCADE,
                CONSTRAINT "FK_department_goal_import_jobs_department_id" FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE RESTRICT,
                CONSTRAINT "FK_department_goal_import_jobs_created_by_id" FOREIGN KEY (created_by_id) REFERENCES admins (id) ON DELETE RESTRICT
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_department_goal_import_jobs_cycle_id" ON department_goal_import_jobs (cycle_id)
        `);

    await queryRunner.query(`
            CREATE TABLE department_goal_import_rows (
                id                UUID          NOT NULL DEFAULT gen_random_uuid(),
                job_id            UUID          NOT NULL,
                row_number        INT           NOT NULL,
                data              JSONB         NOT NULL,
                errors            JSONB         NOT NULL DEFAULT '[]',
                status            VARCHAR       NOT NULL DEFAULT 'PENDING',
                created_goal_id   UUID,
                commit_error      VARCHAR,
                created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
                updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
                CONSTRAINT "PK_department_goal_import_rows" PRIMARY KEY (id),
                CONSTRAINT "FK_department_goal_import_rows_job_id" FOREIGN KEY (job_id) REFERENCES department_goal_import_jobs (id) ON DELETE CASCADE
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_department_goal_import_rows_job_id" ON department_goal_import_rows (job_id)
        `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_department_goal_import_rows_job_id"`,
    );
    await queryRunner.query(`DROP TABLE department_goal_import_rows`);
    await queryRunner.query(
      `DROP INDEX "IDX_department_goal_import_jobs_cycle_id"`,
    );
    await queryRunner.query(`DROP TABLE department_goal_import_jobs`);
  }
}
