import { MigrationInterface, QueryRunner } from 'typeorm';

// Tenant-schema change — runs against every church's own schema via
// runTenantMigrations(), not `public`. Backs the Forms module: admin-built
// forms with configurable fields (text/number/dropdown/checkbox/etc.),
// each either members-only or fully public (no login), optionally linked
// to an event. Submissions are keyed by field id inside a jsonb blob
// rather than a normalized per-answer table, so editing or removing a
// field later never requires migrating past submissions.
export class AddForms1791158400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS forms (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title       VARCHAR NOT NULL,
        description VARCHAR,
        visibility  VARCHAR NOT NULL DEFAULT 'MEMBERS',
        event_id    UUID NULL REFERENCES events(id) ON DELETE SET NULL,
        is_active   BOOLEAN NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_forms_event_id" ON forms(event_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_forms_visibility ON forms(visibility)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_forms_is_active ON forms(is_active)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS form_fields (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        form_id       UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
        label         VARCHAR NOT NULL,
        field_type    VARCHAR NOT NULL DEFAULT 'TEXT',
        required      BOOLEAN NOT NULL DEFAULT false,
        options       TEXT[] NULL,
        "order"       SMALLINT NOT NULL DEFAULT 0,
        auto_fill_key VARCHAR NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_form_fields_form_id" ON form_fields(form_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS form_submissions (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        form_id     UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
        member_id   UUID NULL REFERENCES members(id) ON DELETE SET NULL,
        answers     JSONB NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_form_submissions_form_id" ON form_submissions(form_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_form_submissions_member_id" ON form_submissions(member_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS form_submissions`);
    await queryRunner.query(`DROP TABLE IF EXISTS form_fields`);
    await queryRunner.query(`DROP TABLE IF EXISTS forms`);
  }
}
