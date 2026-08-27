import { MigrationInterface, QueryRunner } from 'typeorm';

// Backs guest (non-member) enrollment in Training Classes — a person with
// no Member account who still needs real portal access (view assignments,
// submit work), not just an admin-side roster entry. Deliberately a proper
// entity rather than inline columns on class_enrollments: unlike a Contact
// List's one-off phone number, a class guest is expected to be a repeat,
// evolving identity across multiple classes over time, so their contact
// details are stored once and referenced, not duplicated per enrollment.
export class AddGuests1793084400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE guests (
        id                  UUID NOT NULL DEFAULT gen_random_uuid(),
        first_name          VARCHAR NOT NULL,
        last_name           VARCHAR NOT NULL,
        email               VARCHAR NOT NULL,
        phone               VARCHAR NULL,
        church_name         VARCHAR NULL,
        address             VARCHAR NULL,
        notes               TEXT NULL,
        converted_member_id UUID NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guests" PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_guests_email" ON guests (email);`,
    );
    await queryRunner.query(
      `ALTER TABLE ONLY guests ADD CONSTRAINT "FK_guests_convertedMemberId" FOREIGN KEY (converted_member_id) REFERENCES members(id) ON DELETE SET NULL;`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE guests`);
  }
}
