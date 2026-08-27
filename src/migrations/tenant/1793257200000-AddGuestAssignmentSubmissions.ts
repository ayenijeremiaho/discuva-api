import { MigrationInterface, QueryRunner } from 'typeorm';

// Lets a guest (no Member account) submit assignment work, tied to their
// ClassEnrollment instead of a member_id — submitted via the public guest
// portal (ClassPublicController), not an authenticated session. Exactly one
// of member_id/class_enrollment_id is set per submission (unlike
// class_enrollments' "at least one" rule): a submission is made either as
// an authenticated member or as a specific guest enrollment, never both —
// converting a guest to a member later doesn't retroactively rewrite their
// past guest-path submissions, it only affects new ones going forward.
export class AddGuestAssignmentSubmissions1793257200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE assignment_submissions ALTER COLUMN member_id DROP NOT NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE assignment_submissions ADD COLUMN class_enrollment_id UUID NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE ONLY assignment_submissions ADD CONSTRAINT "FK_assignment_submissions_classEnrollmentId" FOREIGN KEY (class_enrollment_id) REFERENCES class_enrollments(id) ON DELETE CASCADE;`,
    );
    await queryRunner.query(
      `ALTER TABLE ONLY assignment_submissions ADD CONSTRAINT "CHK_assignment_submissions_exactly_one_identity" CHECK ((member_id IS NOT NULL) != (class_enrollment_id IS NOT NULL));`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_assignment_submissions_classEnrollmentId" ON assignment_submissions USING btree (class_enrollment_id);`,
    );
    await queryRunner.query(
      `ALTER TABLE ONLY assignment_submissions ADD CONSTRAINT "UQ_assignment_submissions_assignment_enrollment" UNIQUE (assignment_id, class_enrollment_id);`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE assignment_submissions DROP CONSTRAINT "UQ_assignment_submissions_assignment_enrollment";`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_assignment_submissions_classEnrollmentId";`,
    );
    await queryRunner.query(
      `ALTER TABLE assignment_submissions DROP CONSTRAINT "CHK_assignment_submissions_exactly_one_identity";`,
    );
    await queryRunner.query(
      `ALTER TABLE assignment_submissions DROP CONSTRAINT "FK_assignment_submissions_classEnrollmentId";`,
    );
    await queryRunner.query(
      `ALTER TABLE assignment_submissions DROP COLUMN class_enrollment_id;`,
    );
    await queryRunner.query(
      `ALTER TABLE assignment_submissions ALTER COLUMN member_id SET NOT NULL;`,
    );
  }
}
