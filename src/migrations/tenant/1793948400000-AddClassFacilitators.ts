import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClassFacilitators1793948400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE class_facilitators (
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        church_class_id UUID NOT NULL,
        member_id UUID,
        guest_name character varying,
        "order" integer NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_class_facilitators" PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_class_facilitators_church_class_id" ON class_facilitators (church_class_id)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_class_facilitators_member_id" ON class_facilitators (member_id)
    `);
    await queryRunner.query(`
      ALTER TABLE class_facilitators
      ADD CONSTRAINT "FK_class_facilitators_church_class_id"
      FOREIGN KEY (church_class_id) REFERENCES church_classes(id) ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE class_facilitators
      ADD CONSTRAINT "FK_class_facilitators_member_id"
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
    `);

    // Backfill: each class's existing single facilitator becomes one row.
    await queryRunner.query(`
      INSERT INTO class_facilitators (church_class_id, member_id)
      SELECT id, facilitator_id FROM church_classes WHERE facilitator_id IS NOT NULL
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_church_classes_facilitator_id`,
    );
    await queryRunner.query(`
      ALTER TABLE church_classes DROP CONSTRAINT "FK_church_classes_facilitatorId"
    `);
    await queryRunner.query(
      `ALTER TABLE church_classes DROP COLUMN facilitator_id`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE church_classes ADD facilitator_id uuid
    `);
    await queryRunner.query(`
      ALTER TABLE church_classes
      ADD CONSTRAINT "FK_church_classes_facilitatorId"
      FOREIGN KEY (facilitator_id) REFERENCES members(id) ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_church_classes_facilitator_id ON church_classes(facilitator_id)`,
    );

    // Only member-backed facilitators can be restored to the single-FK
    // column; guest-name-only facilitators (which the old schema had no
    // room for) are dropped, and where a class had several member
    // facilitators, only the earliest-order one survives.
    await queryRunner.query(`
      UPDATE church_classes c SET facilitator_id = f.member_id
      FROM (
        SELECT DISTINCT ON (church_class_id) church_class_id, member_id
        FROM class_facilitators
        WHERE member_id IS NOT NULL
        ORDER BY church_class_id, "order" ASC
      ) f
      WHERE c.id = f.church_class_id
    `);

    await queryRunner.query(`DROP TABLE class_facilitators`);
  }
}
