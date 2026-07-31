import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFinanceTables1781568000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE finance_categories (
                id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                name        character varying NOT NULL UNIQUE,
                description character varying,
                created_at  timestamptz NOT NULL DEFAULT now(),
                updated_at  timestamptz NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(`
            CREATE TABLE finance_requests (
                id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                requested_by             uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
                department_id            uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
                category_id              uuid NOT NULL REFERENCES finance_categories(id) ON DELETE RESTRICT,
                reason                   text NOT NULL,
                amount                   numeric(12,2) NOT NULL,
                recipient_bank_name      character varying NOT NULL,
                recipient_account_number character varying NOT NULL,
                recipient_account_name   character varying NOT NULL,
                attachment_url           character varying,
                status                   character varying NOT NULL DEFAULT 'PENDING',
                reviewed_by              uuid REFERENCES admins(id) ON DELETE SET NULL,
                reviewed_at              timestamptz,
                rejection_reason         text,
                proof_url                character varying,
                created_at               timestamptz NOT NULL DEFAULT now(),
                updated_at               timestamptz NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(
      `CREATE INDEX IDX_finance_requests_requested_by ON finance_requests(requested_by)`,
    );
    await queryRunner.query(
      `CREATE INDEX IDX_finance_requests_department ON finance_requests(department_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IDX_finance_requests_status ON finance_requests(status)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS IDX_finance_requests_status`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS IDX_finance_requests_department`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS IDX_finance_requests_requested_by`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS finance_requests`);
    await queryRunner.query(`DROP TABLE IF EXISTS finance_categories`);
  }
}
