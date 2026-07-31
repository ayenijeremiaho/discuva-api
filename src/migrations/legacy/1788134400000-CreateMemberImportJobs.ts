import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMemberImportJobs1788134400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS member_import_jobs (
                id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                original_filename  VARCHAR NOT NULL,
                status             VARCHAR NOT NULL DEFAULT 'READY_FOR_REVIEW',
                total_rows         INT NOT NULL DEFAULT 0,
                valid_rows         INT NOT NULL DEFAULT 0,
                created_count      INT NOT NULL DEFAULT 0,
                failed_commit_count INT NOT NULL DEFAULT 0,
                created_by_id      UUID NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
                created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS member_import_rows (
                id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                job_id           UUID NOT NULL REFERENCES member_import_jobs(id) ON DELETE CASCADE,
                row_number       INT NOT NULL,
                data             JSONB NOT NULL,
                errors           JSONB NOT NULL DEFAULT '[]',
                status           VARCHAR NOT NULL DEFAULT 'PENDING',
                created_member_id UUID,
                commit_error     VARCHAR,
                created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_member_import_rows_job_id ON member_import_rows(job_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS member_import_rows`);
    await queryRunner.query(`DROP TABLE IF EXISTS member_import_jobs`);
  }
}
