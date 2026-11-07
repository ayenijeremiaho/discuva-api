import { MigrationInterface, QueryRunner } from 'typeorm';

// Freeze and email-undo links are looked up by the token's hash, once each.
export class AddAccountLinkTokens1806432000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE discuva_account_codes ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES discuva_accounts(id) ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_discuva_account_codes_link_token" ON discuva_account_codes (code_hash) WHERE used_at IS NULL AND account_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_discuva_account_codes_link_token"`,
    );
    await queryRunner.query(
      `ALTER TABLE discuva_account_codes DROP COLUMN IF EXISTS account_id`,
    );
  }
}
