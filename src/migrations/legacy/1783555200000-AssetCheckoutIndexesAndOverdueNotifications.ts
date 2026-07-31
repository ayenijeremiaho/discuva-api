import { MigrationInterface, QueryRunner } from 'typeorm';

export class AssetCheckoutIndexesAndOverdueNotifications1783555200000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS idx_asset_checkouts_member
                ON asset_checkouts(checked_out_to_member_id)
                WHERE checked_out_to_member_id IS NOT NULL
        `);
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS idx_asset_checkouts_department
                ON asset_checkouts(checked_out_to_department_id)
                WHERE checked_out_to_department_id IS NOT NULL
        `);
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS idx_asset_checkouts_expected_return
                ON asset_checkouts(expected_return_at)
                WHERE expected_return_at IS NOT NULL
        `);

    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS asset_checkout_notifications (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                checkout_id UUID        NOT NULL REFERENCES asset_checkouts(id) ON DELETE CASCADE,
                type        VARCHAR     NOT NULL,
                days_overdue INT,
                sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS idx_acn_checkout
                ON asset_checkout_notifications(checkout_id)
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_acn_checkout_days
                ON asset_checkout_notifications(checkout_id, days_overdue)
                WHERE days_overdue IS NOT NULL
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_acn_checkout_days`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_acn_checkout`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS asset_checkout_notifications`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_asset_checkouts_expected_return`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_asset_checkouts_department`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_asset_checkouts_member`);
  }
}
