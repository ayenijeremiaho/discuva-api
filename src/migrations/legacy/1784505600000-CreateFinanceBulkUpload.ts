import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFinanceBulkUpload1784505600000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS finance_bulk_upload_jobs (
                id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                upload_type       VARCHAR NOT NULL,
                file_hash         VARCHAR NOT NULL UNIQUE,
                original_filename VARCHAR NOT NULL,
                status            VARCHAR NOT NULL DEFAULT 'QUEUED',
                total_rows        INT NOT NULL DEFAULT 0,
                processed_rows    INT NOT NULL DEFAULT 0,
                error_message     TEXT,
                created_by_id     UUID NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
                created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS finance_reconciliation_rows (
                id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                job_id                   UUID NOT NULL REFERENCES finance_bulk_upload_jobs(id) ON DELETE CASCADE,
                row_fingerprint          VARCHAR NOT NULL,
                transaction_fingerprint  VARCHAR NOT NULL,
                transaction_date         DATE NOT NULL,
                narration                TEXT NOT NULL,
                amount                   NUMERIC(15,2) NOT NULL,
                credit_debit             VARCHAR NOT NULL,
                status                   VARCHAR NOT NULL DEFAULT 'PENDING',
                suggested_account_id     UUID REFERENCES finance_accounts(id) ON DELETE SET NULL,
                confirmed_account_id     UUID REFERENCES finance_accounts(id) ON DELETE SET NULL,
                match_note               TEXT,
                created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_bulk_jobs_status ON finance_bulk_upload_jobs(status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_bulk_jobs_type ON finance_bulk_upload_jobs(upload_type)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_bulk_jobs_created_by ON finance_bulk_upload_jobs(created_by_id)`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_recon_row_fingerprint ON finance_reconciliation_rows(job_id, row_fingerprint)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_recon_transaction_fingerprint ON finance_reconciliation_rows(transaction_fingerprint)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_recon_job_status ON finance_reconciliation_rows(job_id, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_recon_suggested_account ON finance_reconciliation_rows(suggested_account_id) WHERE suggested_account_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_recon_confirmed_account ON finance_reconciliation_rows(confirmed_account_id) WHERE confirmed_account_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_recon_date ON finance_reconciliation_rows(transaction_date)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS finance_reconciliation_rows`);
    await queryRunner.query(`DROP TABLE IF EXISTS finance_bulk_upload_jobs`);
  }
}
