import { MigrationInterface, QueryRunner } from 'typeorm';

// Tenant-schema change. Backs training-class assignments: each
// church_classes row can have one or more assignments, students submit
// free-text work against an assignment, and an admin scores it out of
// the assignment's own maxScore. One submission per member per
// assignment, enforced at the DB level.
export class AddAssignments1791331200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS assignments (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        church_class_id UUID NOT NULL REFERENCES church_classes(id) ON DELETE CASCADE,
        title          VARCHAR NOT NULL,
        instructions   TEXT NULL,
        max_score      INTEGER NOT NULL DEFAULT 100,
        due_date       TIMESTAMPTZ NULL,
        is_published   BOOLEAN NOT NULL DEFAULT true,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_assignments_church_class_id" ON assignments(church_class_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS assignment_submissions (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        member_id     UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        content       TEXT NOT NULL,
        submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        score         INTEGER NULL,
        feedback      TEXT NULL,
        graded_by     UUID NULL REFERENCES admins(id) ON DELETE SET NULL,
        graded_at     TIMESTAMPTZ NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_assignment_submissions_assignment_member" UNIQUE (assignment_id, member_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_assignment_submissions_assignment_id" ON assignment_submissions(assignment_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_assignment_submissions_member_id" ON assignment_submissions(member_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS assignment_submissions`);
    await queryRunner.query(`DROP TABLE IF EXISTS assignments`);
  }
}
