import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMemberServeInterest1799218800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE members ADD serve_interest_at TIMESTAMPTZ NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_members_serve_interest_at" ON members (serve_interest_at) WHERE serve_interest_at IS NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_members_serve_interest_at"`);
    await queryRunner.query(
      `ALTER TABLE members DROP COLUMN serve_interest_at`,
    );
  }
}
