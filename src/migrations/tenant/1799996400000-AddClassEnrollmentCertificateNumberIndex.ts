import { MigrationInterface, QueryRunner } from 'typeorm';

// Next certificate number looks up the year's highest with certificate_number LIKE 'CERT-YYYY-%'.
export class AddClassEnrollmentCertificateNumberIndex1799996400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_class_enrollments_certificate_number" ON class_enrollments (certificate_number text_pattern_ops) WHERE certificate_number IS NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_class_enrollments_certificate_number"`,
    );
  }
}
