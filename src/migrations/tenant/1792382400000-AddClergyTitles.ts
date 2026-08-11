import { MigrationInterface, QueryRunner } from 'typeorm';

// Tenant-schema change. Runs after RenamePastorsToClergy (1792378800000),
// so it operates on the `clergy` table, not `pastors`. Replaces the old
// closed 3-value enum (LEAD/PARISH/ASSOCIATE — Pentecostal/Protestant-
// specific, formerly `clergy.type`, née `pastors.type`) with an open,
// tenant-configurable clergy_titles catalog, so a Catholic tenant can use
// Priest/Bishop/Deacon or a Methodist tenant Minister/Elder/District
// Superintendent instead of being locked into "... Pastor" titles.
//
// Additive only — the legacy `type` column is backfilled from but not
// dropped here, so a rollback of the *application* release that follows
// this migration can still read/write it. Dropped in a later, separate
// migration once the new code has baked with no incidents.
export class AddClergyTitles1792382400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS clergy_titles (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        VARCHAR NOT NULL,
        description VARCHAR NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_clergy_titles_name" UNIQUE (name)
      )
    `);

    // Seeds the 3 legacy labels so every existing clergy.type value has a
    // matching title to backfill against below — a tenant is free to
    // rename/delete/add to these afterward via the ClergyTitle CRUD.
    await queryRunner.query(`
      INSERT INTO clergy_titles (name) VALUES
        ('Lead Pastor'),
        ('Parish Pastor'),
        ('Associate Pastor')
      ON CONFLICT (name) DO NOTHING
    `);

    await queryRunner.query(
      `ALTER TABLE clergy ADD COLUMN IF NOT EXISTS clergy_title_id UUID NULL`,
    );

    await queryRunner.query(`
      UPDATE clergy c
      SET clergy_title_id = ct.id
      FROM clergy_titles ct
      WHERE c.clergy_title_id IS NULL
        AND ct.name = CASE c.type
          WHEN 'LEAD' THEN 'Lead Pastor'
          WHEN 'PARISH' THEN 'Parish Pastor'
          WHEN 'ASSOCIATE' THEN 'Associate Pastor'
        END
    `);

    // Fails loudly here (intended) if any clergy row has a legacy type
    // value outside the 3 known ones — that's pre-existing data corruption
    // and should block the migration, not silently drop someone's title.
    await queryRunner.query(
      `ALTER TABLE clergy ALTER COLUMN clergy_title_id SET NOT NULL`,
    );

    await queryRunner.query(`
      ALTER TABLE ONLY clergy
      ADD CONSTRAINT "FK_clergy_clergy_title_id" FOREIGN KEY (clergy_title_id) REFERENCES clergy_titles(id)
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_clergy_clergy_title_id" ON clergy(clergy_title_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE clergy DROP CONSTRAINT IF EXISTS "FK_clergy_clergy_title_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_clergy_clergy_title_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE clergy ALTER COLUMN clergy_title_id DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE clergy DROP COLUMN IF EXISTS clergy_title_id`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS clergy_titles`);
  }
}
