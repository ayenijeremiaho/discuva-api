import { MigrationInterface, QueryRunner } from 'typeorm';

// buildRecordsQb's search matches r.external_reference via a leading-
// wildcard LIKE, same as the member firstname/lastname/email columns
// trigram-indexed in AddSearchIndexesAndDropRedundant — external_reference
// was left out at the time. Only external_reference gets the index, not
// reference: external_reference is what PAYMENT_GATEWAY rows carry (the
// vendor reference this search exists to find, for settlement/
// accountability), while reference is null for those rows and only used by
// manual bank-proof entries. tithe_records is a high-write table (the same
// migration above dropped a redundant plain index from it for that reason),
// so this stays limited to the column the search actually needs.
export class AddTitheRecordsExternalReferenceTrgmIndex1794380400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tithe_records_external_reference_trgm" ON tithe_records USING gin (external_reference gin_trgm_ops)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tithe_records_external_reference_trgm"`,
    );
  }
}
