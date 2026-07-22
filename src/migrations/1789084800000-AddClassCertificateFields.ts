import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClassCertificateFields1789084800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE class_enrollments
        ADD COLUMN certificate_issued boolean NOT NULL DEFAULT false,
        ADD COLUMN certificate_issued_at timestamptz,
        ADD COLUMN certificate_number character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE class_enrollments
        DROP COLUMN certificate_issued,
        DROP COLUMN certificate_issued_at,
        DROP COLUMN certificate_number
    `);
  }
}
