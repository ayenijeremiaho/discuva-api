import { MigrationInterface, QueryRunner } from 'typeorm';

// Second variant dimension alongside tier_key/currency — 'monthly' is a
// correct default for every existing row, so unlike tier_key this doesn't
// need the add-nullable -> backfill -> set-not-null dance.
export class AddBillingIntervalToPlans1792785600000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE plans ADD COLUMN billing_interval VARCHAR NOT NULL DEFAULT 'monthly'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE plans DROP COLUMN billing_interval`);
  }
}
