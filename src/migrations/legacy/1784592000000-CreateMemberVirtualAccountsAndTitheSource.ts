import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMemberVirtualAccountsAndTitheSource1784592000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS member_virtual_accounts (
                id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                member_id        UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
                provider         VARCHAR NOT NULL,
                bank_name        VARCHAR NOT NULL,
                account_number   VARCHAR NOT NULL,
                account_name     VARCHAR NOT NULL,
                provider_ref     VARCHAR NOT NULL UNIQUE,
                is_active        BOOLEAN NOT NULL DEFAULT true,
                deactivated_by_id UUID REFERENCES admins(id) ON DELETE SET NULL,
                deactivated_at   TIMESTAMPTZ,
                created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_virtual_accounts_member ON member_virtual_accounts(member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_virtual_accounts_provider ON member_virtual_accounts(provider)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_virtual_accounts_active ON member_virtual_accounts(is_active) WHERE is_active = true`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_virtual_accounts_member_provider ON member_virtual_accounts(member_id, provider)`,
    );

    await queryRunner.query(
      `ALTER TABLE tithe_records ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'MANUAL_PROOF'`,
    );
    await queryRunner.query(
      `ALTER TABLE tithe_records ADD COLUMN IF NOT EXISTS external_reference VARCHAR`,
    );
    await queryRunner.query(
      `ALTER TABLE tithe_records ADD COLUMN IF NOT EXISTS payment_channel VARCHAR`,
    );
    await queryRunner.query(
      `ALTER TABLE tithe_records ADD COLUMN IF NOT EXISTS virtual_account_id UUID REFERENCES member_virtual_accounts(id) ON DELETE SET NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tithe_source ON tithe_records(source)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tithe_virtual_account ON tithe_records(virtual_account_id) WHERE virtual_account_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_tithe_virtual_account`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_tithe_source`);
    await queryRunner.query(
      `ALTER TABLE tithe_records DROP COLUMN IF EXISTS virtual_account_id`,
    );
    await queryRunner.query(
      `ALTER TABLE tithe_records DROP COLUMN IF EXISTS payment_channel`,
    );
    await queryRunner.query(
      `ALTER TABLE tithe_records DROP COLUMN IF EXISTS external_reference`,
    );
    await queryRunner.query(
      `ALTER TABLE tithe_records DROP COLUMN IF EXISTS source`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS member_virtual_accounts`);
  }
}
