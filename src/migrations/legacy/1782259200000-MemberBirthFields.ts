import { MigrationInterface, QueryRunner } from 'typeorm';

export class MemberBirthFields1782259200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE members
                DROP COLUMN IF EXISTS date_of_birth,
                ADD COLUMN IF NOT EXISTS birth_day   smallint NULL,
                ADD COLUMN IF NOT EXISTS birth_month smallint NULL,
                ADD COLUMN IF NOT EXISTS birth_year  smallint NULL
        `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE members
                DROP COLUMN IF EXISTS birth_day,
                DROP COLUMN IF EXISTS birth_month,
                DROP COLUMN IF EXISTS birth_year,
                ADD COLUMN IF NOT EXISTS date_of_birth date NULL
        `);
  }
}
