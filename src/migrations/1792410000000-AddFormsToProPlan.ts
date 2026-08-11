import { MigrationInterface, QueryRunner } from 'typeorm';

// plans.features is a plain text[] snapshotted at seed time
// (1790640000000-AddPlatformControlPlaneTables) — adding PlanFeature.FORMS
// to the enum does nothing for the already-seeded `pro` row without this.
// Idempotent: only appends if missing.
export class AddFormsToProPlan1792410000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans
       SET features = array_append(features, 'forms')
       WHERE id = 'pro'
         AND NOT ('forms' = ANY(features))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans
       SET features = array_remove(features, 'forms')
       WHERE id = 'pro'`,
    );
  }
}
