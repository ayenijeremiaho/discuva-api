import { MigrationInterface, QueryRunner } from 'typeorm';

// Product decision: Tithe/Giving (manual recording, BYOK payment-provider
// config, and the member checkout flow — all gated by the single 'tithe'
// module key) moves from Free to Pro-only. Zero cost to Discuva either way
// (giving-checkout is BYOK, money never touches Discuva), but it's one of
// the highest business-value features in the app, so it moves alongside
// SMS as an intentional Pro upsell rather than a cost-driven one. Already
// present in pro.features (added by the 1792420000000 backfill) — this
// only removes it from free.
export class MoveTitheToProOnly1792430000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans SET features = array_remove(features, 'tithe')
       WHERE id = 'free'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans SET features = array_append(features, 'tithe')
       WHERE id = 'free' AND NOT ('tithe' = ANY(features))`,
    );
  }
}
