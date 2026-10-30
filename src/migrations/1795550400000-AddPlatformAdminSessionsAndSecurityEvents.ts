import { MigrationInterface, QueryRunner } from 'typeorm';

// Lets 2FA changes end other console sessions, and records those changes for other platform admins to see.
export class AddPlatformAdminSessionsAndSecurityEvents1795550400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS sessions_valid_from timestamptz`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS platform_admin_security_events (
         id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
         platform_admin_id uuid NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
         actor_id uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
         action character varying NOT NULL,
         created_at timestamptz NOT NULL DEFAULT now(),
         updated_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_platform_admin_security_events_admin_created"
         ON platform_admin_security_events (platform_admin_id, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_platform_admin_security_events_actor"
         ON platform_admin_security_events (actor_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS platform_admin_security_events`,
    );
    await queryRunner.query(
      `ALTER TABLE platform_admins DROP COLUMN IF EXISTS sessions_valid_from`,
    );
  }
}
