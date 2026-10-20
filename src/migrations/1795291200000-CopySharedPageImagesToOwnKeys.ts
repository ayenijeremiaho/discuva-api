import { MigrationInterface, QueryRunner } from 'typeorm';

// Pages that used to share one image key now each have their own. A church that had replaced the shared image keeps
// seeing it on every page: the override is copied to each new key, so the pages only drift apart once an admin changes one.
const COPIES: [from: string, to: string][] = [
  ['profile-journal', 'more-hero'],
  ['profile-journal', 'my-week-hero'],
  ['profile-journal', 'my-journey-hero'],
  ['attendance-backdrop', 'admin-checkin-hero'],
  ['leave-request-backdrop', 'pastor-feedback-hero'],
  ['prayer-hands-bible', 'evangelism-hero'],
  ['service-hands', 'order-of-service-hero'],
  ['service-hands', 'volunteering-hero'],
  ['service-hands', 'serving-rota-hero'],
  ['teamwork-hands-unity', 'forms-hero'],
  ['teamwork-hands-unity', 'department-goals-hero'],
  ['teamwork-hands-unity', 'department-summary-hero'],
  ['teamwork-hands-unity', 'team-pulse-hero'],
  ['teamwork-hands-unity', 'team-spaces-hero'],
];

export class CopySharedPageImagesToOwnKeys1795291200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Replacing or removing an image now checks whether another key still uses the file.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tenant_asset_overrides_image_public_id" ON tenant_asset_overrides (image_public_id)`,
    );
    for (const [from, to] of COPIES)
      await queryRunner.query(
        `INSERT INTO tenant_asset_overrides (tenant_id, asset_key, image_url, image_public_id)
         SELECT tenant_id, $2, image_url, image_public_id FROM tenant_asset_overrides WHERE asset_key = $1
         ON CONFLICT (tenant_id, asset_key) DO NOTHING`,
        [from, to],
      );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only copies still pointing at the original picture; anything an admin has since replaced stays.
    for (const [from, to] of COPIES)
      await queryRunner.query(
        `DELETE FROM tenant_asset_overrides c USING tenant_asset_overrides o
         WHERE c.asset_key = $2 AND o.asset_key = $1 AND o.tenant_id = c.tenant_id AND o.image_public_id = c.image_public_id`,
        [from, to],
      );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tenant_asset_overrides_image_public_id"`,
    );
  }
}
