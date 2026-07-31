import { MigrationInterface, QueryRunner } from 'typeorm';

export class RequestLeaveDateColumns1782172800000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE request_leave
                ALTER COLUMN date_from TYPE date USING date_from::date,
                ALTER COLUMN date_to TYPE date USING date_to::date
        `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE request_leave
                ALTER COLUMN date_from TYPE timestamptz USING date_from::timestamptz,
                ALTER COLUMN date_to TYPE timestamptz USING date_to::timestamptz
        `);
  }
}
