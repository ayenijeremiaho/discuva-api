import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClassMaterials1793775600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE class_materials (
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        church_class_id UUID NOT NULL,
        title character varying NOT NULL,
        url character varying NOT NULL,
        public_id character varying,
        resource_type character varying,
        mime_type character varying,
        size_bytes bigint,
        "order" integer NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_class_materials" PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_class_materials_church_class_id" ON class_materials (church_class_id)
    `);
    await queryRunner.query(`
      ALTER TABLE class_materials
      ADD CONSTRAINT "FK_class_materials_church_class_id"
      FOREIGN KEY (church_class_id) REFERENCES church_classes(id) ON DELETE CASCADE
    `);

    // Backfill: each class's existing single link becomes one material row.
    // public_id is left NULL for all of these — the old uploadMaterial()
    // never persisted it, so there is no way to recover which Cloudinary
    // asset (if any) a given pre-existing document_url came from. These
    // rows behave exactly like a pasted link going forward (safe, nothing
    // to clean up on delete).
    await queryRunner.query(`
      INSERT INTO class_materials (church_class_id, title, url)
      SELECT id, 'Study Material', document_url FROM church_classes WHERE document_url IS NOT NULL
    `);

    await queryRunner.query(
      `ALTER TABLE church_classes DROP COLUMN document_url`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE church_classes ADD document_url character varying`,
    );
    await queryRunner.query(`
      UPDATE church_classes c SET document_url = m.url
      FROM (
        SELECT DISTINCT ON (church_class_id) church_class_id, url
        FROM class_materials
        ORDER BY church_class_id, "order" ASC
      ) m
      WHERE c.id = m.church_class_id
    `);
    await queryRunner.query(`DROP TABLE class_materials`);
  }
}
