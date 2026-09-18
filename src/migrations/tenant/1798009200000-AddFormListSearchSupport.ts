import { MigrationInterface, QueryRunner } from 'typeorm';

// Matches the trgm-index pattern AddVolunteerSmallGroupGameSearchIndexes
// (1797318000000) already established for volunteer_opportunities/
// small_groups/games — GET /forms is now genuinely paginated
// (FormService.listForms), and its new search param is ILIKE '%term%' on
// title/description, which a plain btree can't serve. purpose/visibility/
// isActive are already covered by IDX_forms_purpose and the pre-existing
// idx_forms_visibility/idx_forms_is_active, so only search needs new
// indexes here.
export class AddFormListSearchSupport1798009200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_forms_title_trgm" ON forms USING gin (title gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_forms_description_trgm" ON forms USING gin (description gin_trgm_ops)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_forms_description_trgm"`);
    await queryRunner.query(`DROP INDEX "IDX_forms_title_trgm"`);
  }
}
