import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePagesTable1795849200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE pages (
          id                  UUID          NOT NULL DEFAULT gen_random_uuid(),
          slug                VARCHAR       NOT NULL,
          title               VARCHAR       NOT NULL,
          seo_description     TEXT,
          og_image_url        VARCHAR,
          og_image_public_id  VARCHAR,
          is_published        BOOLEAN       NOT NULL DEFAULT false,
          sections            JSONB         NOT NULL DEFAULT '[]',
          created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
          updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
          CONSTRAINT "PK_pages" PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_pages_slug" ON pages (slug)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_pages_slug"`);
    await queryRunner.query(`DROP TABLE pages`);
  }
}
