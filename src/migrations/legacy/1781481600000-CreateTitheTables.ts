import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTitheTables1781481600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE tithe_upload_batches (
                id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                uploaded_by       uuid NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
                file_name         character varying NOT NULL,
                status            character varying NOT NULL DEFAULT 'PENDING',
                total_rows        int NOT NULL DEFAULT 0,
                matched_rows      int NOT NULL DEFAULT 0,
                unmatched_rows    int NOT NULL DEFAULT 0,
                disputed_rows     int NOT NULL DEFAULT 0,
                error_message     character varying,
                processed_at      timestamptz,
                created_at        timestamptz NOT NULL DEFAULT now(),
                updated_at        timestamptz NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(`
            CREATE TABLE tithe_records (
                id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                member_id    uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
                batch_id     uuid NOT NULL REFERENCES tithe_upload_batches(id) ON DELETE RESTRICT,
                amount       numeric(12,2) NOT NULL,
                payment_date date NOT NULL,
                reference    character varying,
                bank_name    character varying,
                created_at   timestamptz NOT NULL DEFAULT now(),
                updated_at   timestamptz NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(
      `CREATE INDEX IDX_tithe_records_member ON tithe_records(member_id)`,
    );

    await queryRunner.query(`
            CREATE TABLE tithe_unmatched_records (
                id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                batch_id            uuid NOT NULL REFERENCES tithe_upload_batches(id) ON DELETE RESTRICT,
                raw_email           character varying NOT NULL,
                amount              numeric(12,2) NOT NULL,
                payment_date        date NOT NULL,
                reference           character varying,
                bank_name           character varying,
                status              character varying NOT NULL DEFAULT 'PENDING',
                matched_member_id   uuid REFERENCES members(id) ON DELETE SET NULL,
                resolved_by         uuid REFERENCES admins(id) ON DELETE SET NULL,
                resolved_at         timestamptz,
                created_at          timestamptz NOT NULL DEFAULT now(),
                updated_at          timestamptz NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(`
            CREATE TABLE tithe_dispute_records (
                id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                batch_id           uuid NOT NULL REFERENCES tithe_upload_batches(id) ON DELETE RESTRICT,
                existing_record_id uuid NOT NULL REFERENCES tithe_records(id) ON DELETE RESTRICT,
                member_id          uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
                amount             numeric(12,2) NOT NULL,
                payment_date       date NOT NULL,
                reference          character varying,
                bank_name          character varying,
                status             character varying NOT NULL DEFAULT 'PENDING',
                reviewed_by        uuid REFERENCES admins(id) ON DELETE SET NULL,
                reviewed_at        timestamptz,
                created_at         timestamptz NOT NULL DEFAULT now(),
                updated_at         timestamptz NOT NULL DEFAULT now()
            )
        `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tithe_dispute_records`);
    await queryRunner.query(`DROP TABLE IF EXISTS tithe_unmatched_records`);
    await queryRunner.query(`DROP INDEX IF EXISTS IDX_tithe_records_member`);
    await queryRunner.query(`DROP TABLE IF EXISTS tithe_records`);
    await queryRunner.query(`DROP TABLE IF EXISTS tithe_upload_batches`);
  }
}
