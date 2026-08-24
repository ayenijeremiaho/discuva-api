import { MigrationInterface, QueryRunner } from 'typeorm';

// pg_trgm is a database-wide object (one row in pg_catalog.pg_extension for
// the whole database, not per-schema) — created here, once, on the public
// migration path (single connection, runs before migrate-all-tenants.js
// starts its concurrent tenant workers), mirroring how uuid-ossp is handled
// in Baseline.ts. It must NOT be created from a tenant-schema migration:
// migrate-all-tenants.js runs several tenants' migrations concurrently, and
// two workers hitting `CREATE EXTENSION IF NOT EXISTS pg_trgm` at the same
// moment race on pg_extension's unique index — the IF NOT EXISTS check and
// the insert aren't atomic across concurrent transactions.
export class AddPgTrgmExtension1793390400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP EXTENSION IF EXISTS pg_trgm;`);
  }
}
