import { MigrationInterface, QueryRunner } from 'typeorm';

// Tenant-schema change. social_accounts previously only recorded which
// platform/account an admin intended to post to (isConnected always false,
// no OAuth wired in yet). These columns store the actual tokens once a real
// per-platform OAuth connect flow completes — encrypted at rest via
// EncryptionService, same convention as tenant_communication_provider_configs.
export class AddSocialAccountOAuthTokens1792738800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE social_accounts
        ADD COLUMN access_token_encrypted VARCHAR NULL,
        ADD COLUMN refresh_token_encrypted VARCHAR NULL,
        ADD COLUMN token_expires_at TIMESTAMPTZ NULL,
        ADD COLUMN scope VARCHAR NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE social_accounts
        DROP COLUMN access_token_encrypted,
        DROP COLUMN refresh_token_encrypted,
        DROP COLUMN token_expires_at,
        DROP COLUMN scope
    `);
  }
}
