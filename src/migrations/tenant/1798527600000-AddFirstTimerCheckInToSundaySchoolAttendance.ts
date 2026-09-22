import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFirstTimerCheckInToSundaySchoolAttendance1798527600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE sunday_school_attendances ADD first_timer_id UUID
        `);
    await queryRunner.query(`
            ALTER TABLE sunday_school_attendances
            ADD CONSTRAINT "FK_sunday_school_attendances_first_timer_id"
            FOREIGN KEY (first_timer_id) REFERENCES first_timers (id) ON DELETE CASCADE
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_sunday_school_attendances_first_timer_id" ON sunday_school_attendances (first_timer_id)
        `);

    // Every existing row has member_id set (first_timer_id is new and
    // starts null everywhere), so this CHECK only ever constrains rows
    // going forward — exactly one of the two must be set, never both,
    // never neither.
    await queryRunner.query(`
            ALTER TABLE sunday_school_attendances
            ADD CONSTRAINT "CHK_sunday_school_attendances_member_xor_first_timer"
            CHECK (
                (member_id IS NOT NULL AND first_timer_id IS NULL)
                OR (member_id IS NULL AND first_timer_id IS NOT NULL)
            )
        `);

    // Postgres treats every NULL as distinct in a UNIQUE constraint, so
    // the existing (session_id, member_id) constraint already tolerates
    // any number of first-timer rows (member_id NULL) per session — a
    // second constraint on (session_id, first_timer_id) is what actually
    // prevents double-checking-in the same first-timer twice.
    await queryRunner.query(`
            ALTER TABLE sunday_school_attendances
            ADD CONSTRAINT "UQ_sunday_school_attendances_session_first_timer"
            UNIQUE (session_id, first_timer_id)
        `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE sunday_school_attendances DROP CONSTRAINT "UQ_sunday_school_attendances_session_first_timer"
        `);
    await queryRunner.query(`
            ALTER TABLE sunday_school_attendances DROP CONSTRAINT "CHK_sunday_school_attendances_member_xor_first_timer"
        `);
    await queryRunner.query(`
            DROP INDEX "IDX_sunday_school_attendances_first_timer_id"
        `);
    await queryRunner.query(`
            ALTER TABLE sunday_school_attendances DROP CONSTRAINT "FK_sunday_school_attendances_first_timer_id"
        `);
    await queryRunner.query(`
            ALTER TABLE sunday_school_attendances DROP COLUMN first_timer_id
        `);
  }
}
