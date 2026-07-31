import { MigrationInterface, QueryRunner } from 'typeorm';

export class SundaySchoolSelfMarkWindow1782345600000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE sunday_school_sessions
                DROP COLUMN IF EXISTS self_mark_open,
                ADD COLUMN self_mark_closes_at TIMESTAMPTZ NULL
        `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE sunday_school_sessions
                DROP COLUMN IF EXISTS self_mark_closes_at,
                ADD COLUMN self_mark_open BOOLEAN NOT NULL DEFAULT FALSE
        `);
  }
}
