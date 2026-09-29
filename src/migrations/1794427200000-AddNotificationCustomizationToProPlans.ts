import { MigrationInterface, QueryRunner } from 'typeorm';

// plans.features is snapshotted at seed time, so existing Pro rows need the new key appended. Idempotent.
export class AddNotificationCustomizationToProPlans1794427200000 implements MigrationInterface {
  private readonly planIds = ['pro', 'pro-annual', 'pro-usd', 'pro-usd-annual'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const planId of this.planIds) {
      await queryRunner.query(
        `UPDATE plans
         SET features = array_append(features, 'notification_customization')
         WHERE id = $1 AND NOT ('notification_customization' = ANY(features))`,
        [planId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const planId of this.planIds) {
      await queryRunner.query(
        `UPDATE plans
         SET features = array_remove(features, 'notification_customization')
         WHERE id = $1`,
        [planId],
      );
    }
  }
}
