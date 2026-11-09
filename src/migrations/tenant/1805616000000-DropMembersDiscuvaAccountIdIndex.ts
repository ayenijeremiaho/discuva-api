import { MigrationInterface, QueryRunner } from 'typeorm';

// Nothing looks members up by account (the shared links table does that), so the index only cost writes.
export class DropMembersDiscuvaAccountIdIndex1805616000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_members_discuva_account_id"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_members_discuva_account_id" ON members (discuva_account_id) WHERE discuva_account_id IS NOT NULL`,
    );
  }
}
