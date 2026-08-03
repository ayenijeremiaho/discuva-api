import { MigrationInterface, QueryRunner } from 'typeorm';

// Control-plane change — `tenants` lives in `public`, never a `search_path`
// target. Without this, a branch's rollup (member count, attendance,
// giving) became visible to its parent the instant an invite was accepted,
// with no notice or opt-out — this closes that gap.
//
// share_data_with_parent defaults true: being a branch structurally implies
// a reporting relationship (that's the point of the feature), and the
// branch admin who accepted the invite already knows a parent relationship
// is being formed. share_giving_with_parent defaults false regardless —
// giving specifically stays opt-in even when general sharing is on, given
// how sensitive individual church finances are treated everywhere else in
// this codebase (dedicated TITHE_READ permission, PII-scrubbing
// conventions). Both are self-service, settable only by the branch's own
// admin, never the parent.
export class AddBranchSharingConsent1791244800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants
      ADD COLUMN IF NOT EXISTS share_data_with_parent BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS share_giving_with_parent BOOLEAN NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants
      DROP COLUMN IF EXISTS share_data_with_parent,
      DROP COLUMN IF EXISTS share_giving_with_parent
    `);
  }
}
