import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDiscuvaAccountIdToMembers1805529600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE members ADD COLUMN IF NOT EXISTS discuva_account_id uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_members_discuva_account_id" ON members (discuva_account_id) WHERE discuva_account_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_members_discuva_account_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE members DROP COLUMN IF EXISTS discuva_account_id`,
    );
  }
}
