import { MigrationInterface, QueryRunner } from 'typeorm';

// tier_key groups multiple currency variants of the same conceptual tier
// (e.g. 'pro' and 'pro-usd' both carrying tier_key = 'pro') — purely a
// display/grouping key, never used in billing logic (Subscription.planId,
// PlanGuard, checkout, etc. all keep keying off `id`, unaffected by this
// column). Existing rows are each their own tier today, so backfilling
// tier_key = id is the correct default. NOT NULL can't be declared inline
// on a table with existing rows, hence add-nullable -> backfill -> set-not-null.
export class AddTierKeyToPlans1792612800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE plans ADD COLUMN tier_key VARCHAR`);
    await queryRunner.query(`UPDATE plans SET tier_key = id`);
    await queryRunner.query(
      `ALTER TABLE plans ALTER COLUMN tier_key SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE plans DROP COLUMN tier_key`);
  }
}
