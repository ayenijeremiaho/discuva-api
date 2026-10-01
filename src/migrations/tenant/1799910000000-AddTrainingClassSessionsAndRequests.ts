import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTrainingClassSessionsAndRequests1799910000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE church_classes
        ADD min_attendance_percent integer,
        ADD require_all_assignments boolean NOT NULL DEFAULT false,
        ADD open_for_requests boolean NOT NULL DEFAULT false,
        ADD capacity integer
    `);

    await queryRunner.query(`
      CREATE TABLE class_sessions (
        id              UUID          NOT NULL DEFAULT gen_random_uuid(),
        church_class_id UUID          NOT NULL,
        title           character varying,
        starts_at       TIMESTAMPTZ   NOT NULL,
        ends_at         TIMESTAMPTZ,
        mode            character varying NOT NULL DEFAULT 'PHYSICAL',
        location        character varying,
        meeting_link    character varying,
        notes           text,
        created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_class_sessions" PRIMARY KEY (id),
        CONSTRAINT "FK_class_sessions_church_class_id" FOREIGN KEY (church_class_id) REFERENCES church_classes (id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_class_sessions_church_class_id_starts_at" ON class_sessions (church_class_id, starts_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE class_session_attendances (
        id                  UUID        NOT NULL DEFAULT gen_random_uuid(),
        session_id          UUID        NOT NULL,
        enrollment_id       UUID        NOT NULL,
        status              character varying NOT NULL,
        marked_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        marked_by_admin_id  UUID,
        marked_by_member_id UUID,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_class_session_attendances" PRIMARY KEY (id),
        CONSTRAINT "UQ_class_session_attendances_session_enrollment" UNIQUE (session_id, enrollment_id),
        CONSTRAINT "FK_class_session_attendances_session_id" FOREIGN KEY (session_id) REFERENCES class_sessions (id) ON DELETE CASCADE,
        CONSTRAINT "FK_class_session_attendances_enrollment_id" FOREIGN KEY (enrollment_id) REFERENCES class_enrollments (id) ON DELETE CASCADE,
        CONSTRAINT "FK_class_session_attendances_marked_by_admin_id" FOREIGN KEY (marked_by_admin_id) REFERENCES admins (id) ON DELETE SET NULL,
        CONSTRAINT "FK_class_session_attendances_marked_by_member_id" FOREIGN KEY (marked_by_member_id) REFERENCES members (id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_class_session_attendances_enrollment_id" ON class_session_attendances (enrollment_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE class_join_requests (
        id                  UUID        NOT NULL DEFAULT gen_random_uuid(),
        church_class_id     UUID        NOT NULL,
        member_id           UUID        NOT NULL,
        message             text,
        status              character varying NOT NULL DEFAULT 'PENDING',
        decline_reason      text,
        decided_by_admin_id UUID,
        decided_at          TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_class_join_requests" PRIMARY KEY (id),
        CONSTRAINT "FK_class_join_requests_church_class_id" FOREIGN KEY (church_class_id) REFERENCES church_classes (id) ON DELETE CASCADE,
        CONSTRAINT "FK_class_join_requests_member_id" FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE,
        CONSTRAINT "FK_class_join_requests_decided_by_admin_id" FOREIGN KEY (decided_by_admin_id) REFERENCES admins (id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_class_join_requests_church_class_id" ON class_join_requests (church_class_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_class_join_requests_member_id" ON class_join_requests (member_id)`,
    );
    // One open request per member per class.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_class_join_requests_pending" ON class_join_requests (church_class_id, member_id) WHERE status = 'PENDING'`,
    );

    await queryRunner.query(`
      ALTER TABLE assignment_submissions
        ADD graded_by_member_id UUID,
        ADD CONSTRAINT "FK_assignment_submissions_graded_by_member_id" FOREIGN KEY (graded_by_member_id) REFERENCES members (id) ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_assignment_submissions_graded_by_member_id" ON assignment_submissions (graded_by_member_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_assignment_submissions_graded_by_member_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE assignment_submissions
        DROP CONSTRAINT "FK_assignment_submissions_graded_by_member_id",
        DROP COLUMN graded_by_member_id
    `);
    await queryRunner.query(`DROP TABLE class_join_requests`);
    await queryRunner.query(`DROP TABLE class_session_attendances`);
    await queryRunner.query(`DROP TABLE class_sessions`);
    await queryRunner.query(`
      ALTER TABLE church_classes
        DROP COLUMN capacity,
        DROP COLUMN open_for_requests,
        DROP COLUMN require_all_assignments,
        DROP COLUMN min_attendance_percent
    `);
  }
}
