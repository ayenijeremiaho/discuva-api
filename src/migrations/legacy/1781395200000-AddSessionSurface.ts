import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSessionSurface1781395200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE member_sessions
                ADD COLUMN surface character varying NOT NULL DEFAULT 'MEMBER'
        `);

    await queryRunner.query(`
            ALTER TABLE member_sessions
                ADD CONSTRAINT UQ_member_sessions_member_surface UNIQUE (member_id, surface)
        `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE member_sessions
                DROP CONSTRAINT UQ_member_sessions_member_surface
        `);

    await queryRunner.query(`
            ALTER TABLE member_sessions
                DROP COLUMN surface
        `);
  }
}
