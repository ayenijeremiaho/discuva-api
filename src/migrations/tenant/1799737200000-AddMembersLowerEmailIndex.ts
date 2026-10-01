import { MigrationInterface, QueryRunner } from 'typeorm';

// Case-insensitive email lookups (Sunday School bulk add by email, member search) use LOWER(email).
export class AddMembersLowerEmailIndex1799737200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_members_email_lower" ON members (LOWER(email))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_members_email_lower"`);
  }
}
