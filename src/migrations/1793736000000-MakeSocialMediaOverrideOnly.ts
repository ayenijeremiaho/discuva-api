import { MigrationInterface, QueryRunner } from 'typeorm';

// Product decision: Social Media was backfilled into 'pro'.features when
// the module system first rolled out (never into 'free' — 'social_media'
// was already absent there, confirmed live rather than assumed), making
// it plan-included for every Pro tenant by default. That's no longer
// right for a still-early-access feature going through a controlled
// rollout — remove it from every plan's default and gate access entirely
// through Tenant.moduleOverrides instead: a platform admin Force-On's
// specific tenants from the Tenants page as the rollout expands, then
// re-adds 'social_media' to 'pro'.features (a one-line change, no
// migration needed) once it's ready to be a normal plan-included feature
// again. Same class of change as MoveTitheToProOnly/
// AddDepartmentsToFreePlan, just removing from every 'pro'-tier row
// (pro, pro-annual, pro-usd, pro-usd-annual) rather than just 'free'.
export class MakeSocialMediaOverrideOnly1793736000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans SET features = array_remove(features, 'social_media')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans SET features = array_append(features, 'social_media')
       WHERE tier_key = 'pro' AND NOT ('social_media' = ANY(features))`,
    );
  }
}
