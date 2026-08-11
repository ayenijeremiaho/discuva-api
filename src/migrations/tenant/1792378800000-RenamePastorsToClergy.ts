import { MigrationInterface, QueryRunner } from 'typeorm';

// Tenant-schema change, on a PRE-EXISTING deployed table (`pastors`, from
// the original CreatePastors migration / TenantSchemaGenesis) — unlike the
// clergy_titles catalog (still unshipped as of this pass), this one has
// real tenant data and needs a real, safe rename rather than a rewrite.
//
// Renames the designation entity from "Pastor" to "Clergy" — the whole
// point of the (denomination-neutral) title catalog was undercut by the
// container itself still being called "Pastor" everywhere. `RENAME TO`/
// `RENAME COLUMN`/`RENAME CONSTRAINT` are metadata-only in Postgres (no
// table rewrite, no data movement, existing FKs keep working transparently
// through the rename).
//
// Also adds `can_review_feedback` — deliberately NOT implied by holding a
// title. Today ANY pastors row grants full "see and respond to every
// department's Pastor Feedback report" access regardless of title; that's
// a real permission gap once titling becomes more routine (a promotion
// shouldn't silently grant that). Defaults true so existing clergy don't
// lose access on rollout — an admin can then dial back specific people via
// PATCH /members/:id/clergy/review-access.
export class RenamePastorsToClergy1792378800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE pastors RENAME TO clergy`);

    await queryRunner.query(
      `ALTER TABLE clergy ADD COLUMN can_review_feedback BOOLEAN NOT NULL DEFAULT true`,
    );

    await queryRunner.query(
      `ALTER TABLE pastor_feedback RENAME COLUMN responded_by_pastor_id TO responded_by_clergy_id`,
    );
    await queryRunner.query(
      `ALTER TABLE pastor_feedback RENAME COLUMN responded_by_pastor_name TO responded_by_clergy_name`,
    );
    await queryRunner.query(
      `ALTER TABLE pastor_feedback RENAME CONSTRAINT department_feedback_responded_by_pastor_id_fkey TO department_feedback_responded_by_clergy_id_fkey`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE pastor_feedback RENAME CONSTRAINT department_feedback_responded_by_clergy_id_fkey TO department_feedback_responded_by_pastor_id_fkey`,
    );
    await queryRunner.query(
      `ALTER TABLE pastor_feedback RENAME COLUMN responded_by_clergy_name TO responded_by_pastor_name`,
    );
    await queryRunner.query(
      `ALTER TABLE pastor_feedback RENAME COLUMN responded_by_clergy_id TO responded_by_pastor_id`,
    );

    await queryRunner.query(
      `ALTER TABLE clergy DROP COLUMN can_review_feedback`,
    );

    await queryRunner.query(`ALTER TABLE clergy RENAME TO pastors`);
  }
}
