import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDiscuvaAccounts1806345600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS discuva_accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email character varying NOT NULL,
        password character varying NOT NULL,
        device_id character varying,
        password_changed_at timestamptz,
        frozen_at timestamptz,
        recovered_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_discuva_accounts_email" ON discuva_accounts (email)`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS discuva_account_links (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id uuid NOT NULL REFERENCES discuva_accounts(id) ON DELETE CASCADE,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        member_id uuid NOT NULL,
        linked_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_discuva_account_links_tenant_member" ON discuva_account_links (tenant_id, member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_discuva_account_links_account" ON discuva_account_links (account_id)`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS discuva_account_codes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email character varying NOT NULL,
        purpose character varying(16) NOT NULL,
        code_hash character varying NOT NULL,
        device_id character varying,
        tenant_id uuid,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_discuva_account_codes_open" ON discuva_account_codes (email, purpose, device_id) WHERE used_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_discuva_account_codes_expires_at" ON discuva_account_codes (expires_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS discuva_account_codes`);
    await queryRunner.query(`DROP TABLE IF EXISTS discuva_account_links`);
    await queryRunner.query(`DROP TABLE IF EXISTS discuva_accounts`);
  }
}
