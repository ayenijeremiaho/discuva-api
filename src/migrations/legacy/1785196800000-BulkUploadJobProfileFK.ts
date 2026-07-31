import { MigrationInterface, QueryRunner } from 'typeorm';

export class BulkUploadJobProfileFK1785196800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE finance_bulk_upload_jobs
            ADD COLUMN profile_id UUID REFERENCES finance_bank_import_profiles(id) ON DELETE SET NULL
        `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE finance_bulk_upload_jobs DROP COLUMN IF EXISTS profile_id`,
    );
  }
}
