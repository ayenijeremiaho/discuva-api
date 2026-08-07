import { MigrationInterface, QueryRunner } from 'typeorm';

// The virtual-account giving feature (a dedicated bank account number per
// member, credited via webhook) was never implemented beyond a schema
// scaffold — every VirtualAccountService method threw NotImplementedException
// and the member app's card was labeled "Coming Soon." No production tenant
// has ever had a real row here. Removed in favor of a tenant-owned checkout
// flow instead (BYOK Paystack/Flutterwave/Kora/Stripe credentials, member
// redirected to a hosted checkout page) — a fundamentally different shape,
// not a data migration of this table's (empty) contents.
export class DropMemberVirtualAccounts1792108800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tithe_records DROP COLUMN IF EXISTS virtual_account_id
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS member_virtual_accounts`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS member_virtual_accounts (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        member_id          UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
        provider           VARCHAR NOT NULL,
        bank_name          VARCHAR NOT NULL,
        account_number     VARCHAR NOT NULL,
        account_name       VARCHAR NOT NULL,
        provider_ref       VARCHAR NOT NULL UNIQUE,
        is_active          BOOLEAN NOT NULL DEFAULT true,
        deactivated_by_id  UUID REFERENCES admins(id) ON DELETE SET NULL,
        deactivated_at     TIMESTAMPTZ,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_virtual_accounts_member ON member_virtual_accounts(member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_virtual_accounts_provider ON member_virtual_accounts(provider)`,
    );
    await queryRunner.query(`
      ALTER TABLE tithe_records
      ADD COLUMN IF NOT EXISTS virtual_account_id UUID REFERENCES member_virtual_accounts(id) ON DELETE SET NULL
    `);
  }
}
