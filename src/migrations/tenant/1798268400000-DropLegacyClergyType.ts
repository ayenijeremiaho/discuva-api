import { MigrationInterface, QueryRunner } from 'typeorm';

// The follow-up AddClergyTitles1792382400000 promised in its own comment:
// "the legacy `type` column is backfilled from but not dropped here...
// dropped in a later, separate migration once the new code has baked with
// no incidents." That migration was never written — the Clergy entity
// dropped its `type` property long ago (clergy_title_id/ClergyTitle fully
// replaced it, confirmed no code anywhere still reads/writes clergy.type),
// but the DB column stayed behind as `character varying NOT NULL` with no
// default. Every new clergy INSERT since has been failing in production
// with "null value in column \"type\" of relation \"clergy\" violates
// not-null constraint" — MemberService.assignClergy has no reason to know
// this column still exists. This finally drops it.
export class DropLegacyClergyType1798268400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE clergy DROP COLUMN type
    `);
  }

  // Re-added nullable, not NOT NULL — the original legacy values (LEAD/
  // PARISH/ASSOCIATE) are gone once dropped; a rollback restores the
  // column shape, not the deleted data. No code path writes to it going
  // forward either way.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE clergy ADD COLUMN type character varying
    `);
  }
}
