import { MigrationInterface, QueryRunner } from 'typeorm';

// The platform tenants list reads each church's latest sign-in and 30-day active count per app (WHERE surface = ? on last_login).
export class AddMemberSessionSurfaceLastLoginIndex1802332800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_member_sessions_surface_lastLogin" ON member_sessions (surface, last_login DESC)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_member_sessions_surface_lastLogin"`,
    );
  }
}
