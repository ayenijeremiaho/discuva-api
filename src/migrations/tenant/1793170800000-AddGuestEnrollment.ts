import { MigrationInterface, QueryRunner } from 'typeorm';

// Allows class_enrollments to reference a Guest instead of a Member — see
// AddGuests1793084400000's comment for why guests are a separate entity.
// member_id stays "at least one identity present" rather than an exact XOR
// with guest_id: converting a guest to a member (ClassesService.
// convertGuestToMember) sets member_id on top of the existing guest_id,
// keeping the original guest profile as history rather than clearing it.
export class AddGuestEnrollment1793170800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE class_enrollments ALTER COLUMN member_id DROP NOT NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE class_enrollments ADD COLUMN guest_id UUID NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE class_enrollments ADD COLUMN purpose TEXT NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE ONLY class_enrollments ADD CONSTRAINT "FK_class_enrollments_guestId" FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE SET NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE ONLY class_enrollments ADD CONSTRAINT "CHK_class_enrollments_has_identity" CHECK (member_id IS NOT NULL OR guest_id IS NOT NULL);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_class_enrollments_guestId" ON class_enrollments USING btree (guest_id);`,
    );
    await queryRunner.query(
      `ALTER TABLE ONLY class_enrollments ADD CONSTRAINT "UQ_class_enrollments_guest_class" UNIQUE (guest_id, church_class_id);`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE class_enrollments DROP CONSTRAINT "UQ_class_enrollments_guest_class";`,
    );
    await queryRunner.query(`DROP INDEX "IDX_class_enrollments_guestId";`);
    await queryRunner.query(
      `ALTER TABLE class_enrollments DROP CONSTRAINT "CHK_class_enrollments_has_identity";`,
    );
    await queryRunner.query(
      `ALTER TABLE class_enrollments DROP CONSTRAINT "FK_class_enrollments_guestId";`,
    );
    await queryRunner.query(
      `ALTER TABLE class_enrollments DROP COLUMN purpose;`,
    );
    await queryRunner.query(
      `ALTER TABLE class_enrollments DROP COLUMN guest_id;`,
    );
    await queryRunner.query(
      `ALTER TABLE class_enrollments ALTER COLUMN member_id SET NOT NULL;`,
    );
  }
}
