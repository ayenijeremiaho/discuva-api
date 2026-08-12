import { MigrationInterface, QueryRunner } from 'typeorm';

// Tenant-schema table (schema-unqualified, like member_sessions and
// push_subscriptions) — biometric/passkey login credentials, one row per
// registered device/authenticator. No uniqueness on member_id: unlike
// member_sessions (one row per surface), a member can register several
// devices independently.
export class AddMemberWebauthnCredentials1792479600000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE member_webauthn_credentials (
                id             UUID          NOT NULL DEFAULT gen_random_uuid(),
                member_id      UUID          NOT NULL,
                credential_id  TEXT          NOT NULL,
                public_key     TEXT          NOT NULL,
                counter        BIGINT        NOT NULL DEFAULT 0,
                transports     TEXT[]        NOT NULL DEFAULT '{}',
                device_name    TEXT,
                last_used_at   TIMESTAMPTZ,
                created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
                updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
                CONSTRAINT "PK_member_webauthn_credentials" PRIMARY KEY (id),
                CONSTRAINT "FK_member_webauthn_credentials_member_id" FOREIGN KEY (member_id)
                    REFERENCES members(id) ON DELETE CASCADE
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_member_webauthn_credentials_credential_id"
                ON member_webauthn_credentials (credential_id)
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_member_webauthn_credentials_member_id"
                ON member_webauthn_credentials (member_id)
        `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_member_webauthn_credentials_member_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "UQ_member_webauthn_credentials_credential_id"`,
    );
    await queryRunner.query(`DROP TABLE member_webauthn_credentials`);
  }
}
