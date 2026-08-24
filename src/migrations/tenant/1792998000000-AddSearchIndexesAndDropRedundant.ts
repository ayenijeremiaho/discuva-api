import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSearchIndexesAndDropRedundant1792998000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_members_firstname_trgm" ON members USING gin (firstname gin_trgm_ops);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_members_lastname_trgm" ON members USING gin (lastname gin_trgm_ops);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_members_email_trgm" ON members USING gin (email gin_trgm_ops);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_members_created_at" ON members (created_at);`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_member_directory_profiles_occupation_trgm" ON member_directory_profiles USING gin (occupation gin_trgm_ops);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_member_directory_profiles_business_name_trgm" ON member_directory_profiles USING gin (business_name gin_trgm_ops);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_member_directory_profiles_skills_trgm" ON member_directory_profiles USING gin (skills gin_trgm_ops);`,
    );

    // Redundant with the leftmost column of a composite index already
    // covering it — pure write overhead on two high-write tables
    // (every attendance check-in, every giving record).
    await queryRunner.query(`DROP INDEX "IDX_attendances_member_id";`);
    await queryRunner.query(`DROP INDEX idx_tithe_records_member;`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX idx_tithe_records_member ON tithe_records USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_attendances_member_id" ON attendances USING btree (member_id);`,
    );

    await queryRunner.query(
      `DROP INDEX "IDX_member_directory_profiles_skills_trgm";`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_member_directory_profiles_business_name_trgm";`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_member_directory_profiles_occupation_trgm";`,
    );

    await queryRunner.query(`DROP INDEX "IDX_members_created_at";`);
    await queryRunner.query(`DROP INDEX "IDX_members_email_trgm";`);
    await queryRunner.query(`DROP INDEX "IDX_members_lastname_trgm";`);
    await queryRunner.query(`DROP INDEX "IDX_members_firstname_trgm";`);
  }
}
