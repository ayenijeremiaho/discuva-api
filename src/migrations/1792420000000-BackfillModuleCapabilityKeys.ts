import { MigrationInterface, QueryRunner } from 'typeorm';

// ModuleEnabledGuard now also checks Plan.features for a module's own key
// (see module-enabled.guard.ts) — without this backfill, every tenant on
// either plan would instantly lose access to every currently-free module
// the moment that guard change deploys, since neither plan's features
// array has ever listed a module key before. Idempotent: only appends
// what's missing, safe to re-run.
export class BackfillModuleCapabilityKeys1792420000000
  implements MigrationInterface
{
  // Currently free (module-toggle only, no PlanFeature counterpart) —
  // added to both plans so nothing changes access-wise; a platform admin
  // can remove any of these from `free` afterward to make it Pro-only,
  // from the Plans page, with no further deploy.
  private readonly freeModuleKeys = [
    'prayer',
    'evangelism',
    'classes',
    'tithe',
    'sunday_school',
    'pastor_feedback',
    'small_groups',
    'social_media',
    'children_church',
    'announcements',
    'follow_up',
  ];

  // Already Pro-only today via a separate PlanFeature value that doesn't
  // spell the same as its KNOWN_MODULES key (confirmed: sermons/sermon,
  // service_ratings/service_rating, volunteering/volunteer) — added to
  // `pro` only, alongside the existing spelling, so both the pre-existing
  // @RequiresPlan check and the new ModuleEnabledGuard plan check keep
  // passing for current Pro tenants without touching those controllers.
  private readonly proOnlyModuleKeySpellings = [
    'sermons',
    'service_ratings',
    'volunteering',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const key of this.freeModuleKeys) {
      await queryRunner.query(
        `UPDATE plans SET features = array_append(features, $1)
         WHERE id IN ('free', 'pro') AND NOT ($1 = ANY(features))`,
        [key],
      );
    }
    for (const key of this.proOnlyModuleKeySpellings) {
      await queryRunner.query(
        `UPDATE plans SET features = array_append(features, $1)
         WHERE id = 'pro' AND NOT ($1 = ANY(features))`,
        [key],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const key of [
      ...this.freeModuleKeys,
      ...this.proOnlyModuleKeySpellings,
    ]) {
      await queryRunner.query(
        `UPDATE plans SET features = array_remove(features, $1)
         WHERE id IN ('free', 'pro')`,
        [key],
      );
    }
  }
}
