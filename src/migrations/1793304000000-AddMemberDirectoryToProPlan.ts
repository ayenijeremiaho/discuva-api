import { MigrationInterface, QueryRunner } from 'typeorm';

// plans.features is a plain text[] snapshotted at seed time
// (1790640000000-AddPlatformControlPlaneTables) — adding
// PlanFeature.MEMBER_DIRECTORY to the enum does nothing for the
// already-seeded `pro` row without this. Idempotent: only appends if
// missing. Mirrors 1792410000000-AddFormsToProPlan.
export class AddMemberDirectoryToProPlan1793304000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans
       SET features = array_append(features, 'member_directory')
       WHERE id = 'pro'
         AND NOT ('member_directory' = ANY(features))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans
       SET features = array_remove(features, 'member_directory')
       WHERE id = 'pro'`,
    );
  }
}
