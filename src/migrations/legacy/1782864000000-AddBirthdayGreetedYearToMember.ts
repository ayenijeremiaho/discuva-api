import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBirthdayGreetedYearToMember1782864000000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE members
            ADD COLUMN IF NOT EXISTS birthday_greeted_year SMALLINT DEFAULT NULL
        `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE members DROP COLUMN IF EXISTS birthday_greeted_year`,
    );
  }
}
