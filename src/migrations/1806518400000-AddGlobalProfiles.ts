import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 3: the person's own profile, milestones and photo removals, beside their Discuva account.
export class AddGlobalProfiles1806518400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS discuva_profiles (
        account_id uuid PRIMARY KEY REFERENCES discuva_accounts(id) ON DELETE CASCADE,
        firstname character varying NOT NULL,
        lastname character varying NOT NULL,
        phone_number character varying,
        gender character varying,
        birth_day smallint,
        birth_month smallint,
        birth_year smallint,
        marital_status character varying,
        address character varying(300),
        emergency_contact_name character varying(120),
        emergency_contact_phone character varying(32),
        emergency_contact_relationship character varying(60),
        photo_url character varying,
        photo_public_id character varying,
        appearance_mode character varying NOT NULL DEFAULT 'LIGHT',
        muted_notifications character varying[] NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS discuva_milestones (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id uuid NOT NULL REFERENCES discuva_accounts(id) ON DELETE CASCADE,
        type character varying(24) NOT NULL,
        title character varying(120),
        month smallint,
        year smallint,
        place_tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
        place_name character varying(160),
        source character varying(10) NOT NULL,
        source_tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
        source_name character varying(160),
        source_ref character varying(64),
        visibility character varying(12) NOT NULL DEFAULT 'CHURCHES',
        hidden boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    // One milestone per church and source, so recording again (a class re-completed) is harmless.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_discuva_milestones_account_source" ON discuva_milestones (account_id, source_tenant_id, source_ref) WHERE source_ref IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_discuva_milestones_account" ON discuva_milestones (account_id, year DESC NULLS LAST, month DESC NULLS LAST)`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS discuva_photo_removals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id uuid NOT NULL REFERENCES discuva_accounts(id) ON DELETE CASCADE,
        tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
        admin_id uuid,
        reason character varying(24) NOT NULL,
        note character varying(300),
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_discuva_photo_removals_account" ON discuva_photo_removals (account_id, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_discuva_photo_removals_created" ON discuva_photo_removals (created_at)`,
    );
    await queryRunner.query(
      `ALTER TABLE discuva_account_links ADD COLUMN IF NOT EXISTS consented_at timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE discuva_accounts ADD COLUMN IF NOT EXISTS delete_requested_at timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE discuva_accounts DROP COLUMN IF EXISTS delete_requested_at`,
    );
    await queryRunner.query(
      `ALTER TABLE discuva_account_links DROP COLUMN IF EXISTS consented_at`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS discuva_photo_removals`);
    await queryRunner.query(`DROP TABLE IF EXISTS discuva_milestones`);
    await queryRunner.query(`DROP TABLE IF EXISTS discuva_profiles`);
  }
}
