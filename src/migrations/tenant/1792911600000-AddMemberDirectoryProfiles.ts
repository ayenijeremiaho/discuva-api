import { MigrationInterface, QueryRunner } from 'typeorm';

// Tenant-schema change. Backs the opt-in member directory (module
// 'member_directory') — a member's own occupation/business/skills/bio,
// visible to other members only once they flip is_visible on themselves
// (no admin publish/moderation step, same posture as testimonies.is_public).
// show_phone/show_email are separate from is_visible since surfacing
// contact info is a materially bigger privacy step than showing an
// opted-in occupation/business/bio.
export class AddMemberDirectoryProfiles1792911600000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS member_directory_profiles (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        member_id     UUID NOT NULL UNIQUE REFERENCES members(id) ON DELETE CASCADE,
        occupation    VARCHAR NULL,
        business_name VARCHAR NULL,
        skills        VARCHAR NULL,
        bio           TEXT NULL,
        is_visible    BOOLEAN NOT NULL DEFAULT false,
        show_phone    BOOLEAN NOT NULL DEFAULT false,
        show_email    BOOLEAN NOT NULL DEFAULT false,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_member_directory_profiles_is_visible" ON member_directory_profiles(is_visible)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS member_directory_profiles`);
  }
}
