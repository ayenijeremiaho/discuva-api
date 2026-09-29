import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminFavouritePages1799305200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE admins ADD favourite_pages JSONB NOT NULL DEFAULT '[]'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE admins DROP COLUMN favourite_pages`);
  }
}
