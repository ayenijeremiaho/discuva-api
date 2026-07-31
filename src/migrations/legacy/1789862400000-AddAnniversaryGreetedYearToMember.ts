import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnniversaryGreetedYearToMember1789862400000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE members
      ADD COLUMN anniversary_greeted_year SMALLINT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE members DROP COLUMN anniversary_greeted_year`,
    );
  }
}
