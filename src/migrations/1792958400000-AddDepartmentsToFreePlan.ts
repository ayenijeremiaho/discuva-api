import { MigrationInterface, QueryRunner } from 'typeorm';

// Product decision: 'departments' is marked required: true in
// KNOWN_MODULES (src/church-settings/constants/known-modules.constant.ts)
// — a church can never disable it, the codebase treats it as a
// foundational primitive (attendance, worker profiles, finance requests,
// assets, games, volunteer opportunities, announcements, and event
// reminders all reference department_id). It was nonetheless only ever
// added to 'pro'.features, not 'free'.features, with no migration or
// comment recording that as deliberate — unlike MoveTitheToProOnly, which
// documents its own reasoning. Free-tier tenants have been unable to use
// Departments at all as a result, contradicting the "required" flag.
// Corrected here: added to 'free' only, 'pro' (and its currency/interval
// variants pro-usd/pro-annual/pro-usd-annual, all cloned from 'pro' with
// 'departments' already present) are untouched.
export class AddDepartmentsToFreePlan1792958400000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans SET features = array_append(features, 'departments')
       WHERE id = 'free' AND NOT ('departments' = ANY(features))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans SET features = array_remove(features, 'departments')
       WHERE id = 'free'`,
    );
  }
}
