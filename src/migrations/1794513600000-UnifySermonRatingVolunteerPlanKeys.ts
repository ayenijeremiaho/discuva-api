import { MigrationInterface, QueryRunner } from 'typeorm';

// PlanFeature SERMON/SERVICE_RATING/VOLUNTEER now use the module keys, so one plan entry controls access.
const RENAMES: [string, string][] = [
  ['sermon', 'sermons'],
  ['service_rating', 'service_ratings'],
  ['volunteer', 'volunteering'],
];

export class UnifySermonRatingVolunteerPlanKeys1794513600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [from, to] of RENAMES) {
      await this.rename(queryRunner, from, to);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Old code checks both spellings, so restore the old key alongside the new one.
    for (const [oldKey, newKey] of RENAMES) {
      await queryRunner.query(
        `UPDATE plans SET features = array_append(features, $1)
         WHERE $2 = ANY(features) AND NOT ($1 = ANY(features))`,
        [oldKey, newKey],
      );
    }
  }

  private async rename(
    queryRunner: QueryRunner,
    from: string,
    to: string,
  ): Promise<void> {
    await queryRunner.query(
      `UPDATE plans SET features = array_append(features, $2)
       WHERE $1 = ANY(features) AND NOT ($2 = ANY(features))`,
      [from, to],
    );
    await queryRunner.query(
      `UPDATE plans SET features = array_remove(features, $1)
       WHERE $1 = ANY(features)`,
      [from],
    );
    await queryRunner.query(
      `UPDATE plans
       SET feature_limits = (feature_limits - $1::text)
         || CASE WHEN feature_limits ? $2::text THEN '{}'::jsonb
                 ELSE jsonb_build_object($2::text, feature_limits -> $1::text) END
       WHERE feature_limits ? $1::text`,
      [from, to],
    );
    await queryRunner.query(
      `UPDATE tenants
       SET module_overrides = (module_overrides - $1::text)
         || CASE WHEN module_overrides ? $2::text THEN '{}'::jsonb
                 ELSE jsonb_build_object($2::text, module_overrides -> $1::text) END
       WHERE module_overrides ? $1::text`,
      [from, to],
    );
  }
}
