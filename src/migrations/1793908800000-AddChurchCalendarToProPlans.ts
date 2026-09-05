import { MigrationInterface, QueryRunner } from 'typeorm';

// plans.features is a plain text[] snapshotted at seed time — adding
// PlanFeature.CHURCH_CALENDAR to the enum does nothing for the already-seeded
// plan rows without this. Unlike AddFormsToProPlan (which only targeted the
// 'pro' row, leaving the annual/USD variants without 'forms'), this covers
// every Pro variant so the feature isn't inconsistently available depending
// on which Pro plan a tenant happens to be subscribed to. Idempotent: only
// appends where missing.
export class AddChurchCalendarToProPlans1793908800000 implements MigrationInterface {
  private readonly planIds = ['pro', 'pro-annual', 'pro-usd', 'pro-usd-annual'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const planId of this.planIds) {
      await queryRunner.query(
        `
        UPDATE plans
        SET features = array_append(features, 'church_calendar')
        WHERE id = $1
          AND NOT ('church_calendar' = ANY(features))
        `,
        [planId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const planId of this.planIds) {
      await queryRunner.query(
        `
        UPDATE plans
        SET features = array_remove(features, 'church_calendar')
        WHERE id = $1
        `,
        [planId],
      );
    }
  }
}
