import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBibleCharacterReviews1801900800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // One row per character this church has reviewed, hidden or edited; the character list itself ships with the app.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bible_character_reviews (
          character_id         CHARACTER VARYING NOT NULL,
          hidden               BOOLEAN           NOT NULL DEFAULT false,
          reviewed_by_admin_id UUID              NULL,
          reviewed_at          TIMESTAMPTZ       NULL,
          summary_override     TEXT              NULL,
          clues_override       JSONB             NULL,
          updated_by_admin_id  UUID              NULL,
          created_at           TIMESTAMPTZ       NOT NULL DEFAULT now(),
          updated_at           TIMESTAMPTZ       NOT NULL DEFAULT now(),
          CONSTRAINT "PK_bible_character_reviews" PRIMARY KEY (character_id),
          CONSTRAINT "FK_bible_character_reviews_reviewed_by" FOREIGN KEY (reviewed_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL,
          CONSTRAINT "FK_bible_character_reviews_updated_by" FOREIGN KEY (updated_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
      )
    `);
    // The table is read whole (and cached); these only serve the FKs' ON DELETE SET NULL.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_character_reviews_reviewed_by" ON bible_character_reviews (reviewed_by_admin_id) WHERE reviewed_by_admin_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bible_character_reviews_updated_by" ON bible_character_reviews (updated_by_admin_id) WHERE updated_by_admin_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS bible_character_reviews`);
  }
}
