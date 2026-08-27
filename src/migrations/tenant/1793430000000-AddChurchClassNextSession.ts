import { MigrationInterface, QueryRunner } from 'typeorm';

// A single "next session" field the facilitator updates as the class
// progresses week to week — not a full multi-session schedule entity
// (deliberately the smaller of two options considered, see the guest
// enrollment plan).
export class AddChurchClassNextSession1793430000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE church_classes ADD COLUMN next_session_at TIMESTAMPTZ NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE church_classes ADD COLUMN meeting_link VARCHAR NULL;`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE church_classes DROP COLUMN meeting_link;`,
    );
    await queryRunner.query(
      `ALTER TABLE church_classes DROP COLUMN next_session_at;`,
    );
  }
}
