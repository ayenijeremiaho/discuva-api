import { MigrationInterface, QueryRunner } from 'typeorm';

const BELIEVERS_ID = '11111111-0000-0000-0000-000000000001';
const BAPTISMAL_ID = '11111111-0000-0000-0000-000000000002';
const WORKERS_IN_TRAINING_ID = '11111111-0000-0000-0000-000000000003';
const BIBLE_COLLEGE_ID = '11111111-0000-0000-0000-000000000004';
const SCHOOL_OF_DISCIPLESHIP_ID = '11111111-0000-0000-0000-000000000005';

export class AddClassTypesTable1788480000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE class_types (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name character varying NOT NULL UNIQUE,
        description text,
        is_active boolean NOT NULL DEFAULT true,
        next_class_type_id UUID REFERENCES class_types(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_class_types_is_active" ON class_types (is_active)`,
    );

    await queryRunner.query(
      `
      INSERT INTO class_types (id, name, description, is_active) VALUES
        ($1, 'Believers'' Class', NULL, true),
        ($2, 'Baptismal Class', NULL, true),
        ($3, 'Workers in Training', NULL, true),
        ($4, 'Bible College', NULL, true),
        ($5, 'School of Discipleship', NULL, true)
      `,
      [
        BELIEVERS_ID,
        BAPTISMAL_ID,
        WORKERS_IN_TRAINING_ID,
        BIBLE_COLLEGE_ID,
        SCHOOL_OF_DISCIPLESHIP_ID,
      ],
    );

    await queryRunner.query(
      `ALTER TABLE church_classes ADD COLUMN class_type_id UUID`,
    );

    await queryRunner.query(
      `
      UPDATE church_classes SET class_type_id = CASE type
        WHEN 'BELIEVERS' THEN $1::uuid
        WHEN 'BAPTISMAL' THEN $2::uuid
        WHEN 'WORKERS_IN_TRAINING' THEN $3::uuid
        WHEN 'BIBLE_COLLEGE' THEN $4::uuid
        WHEN 'SCHOOL_OF_DISCIPLESHIP' THEN $5::uuid
      END
      `,
      [
        BELIEVERS_ID,
        BAPTISMAL_ID,
        WORKERS_IN_TRAINING_ID,
        BIBLE_COLLEGE_ID,
        SCHOOL_OF_DISCIPLESHIP_ID,
      ],
    );

    await queryRunner.query(
      `ALTER TABLE church_classes ALTER COLUMN class_type_id SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE church_classes
        ADD CONSTRAINT "FK_church_classes_class_type" FOREIGN KEY (class_type_id)
        REFERENCES class_types(id) ON DELETE RESTRICT
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_church_classes_class_type_id" ON church_classes (class_type_id)`,
    );
    await queryRunner.query(`ALTER TABLE church_classes DROP COLUMN type`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE church_classes ADD COLUMN type character varying`,
    );
    await queryRunner.query(
      `
      UPDATE church_classes SET type = CASE class_type_id
        WHEN $1::uuid THEN 'BELIEVERS'
        WHEN $2::uuid THEN 'BAPTISMAL'
        WHEN $3::uuid THEN 'WORKERS_IN_TRAINING'
        WHEN $4::uuid THEN 'BIBLE_COLLEGE'
        WHEN $5::uuid THEN 'SCHOOL_OF_DISCIPLESHIP'
      END
      `,
      [
        BELIEVERS_ID,
        BAPTISMAL_ID,
        WORKERS_IN_TRAINING_ID,
        BIBLE_COLLEGE_ID,
        SCHOOL_OF_DISCIPLESHIP_ID,
      ],
    );
    await queryRunner.query(
      `ALTER TABLE church_classes ALTER COLUMN type SET NOT NULL`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_church_classes_class_type_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE church_classes DROP CONSTRAINT "FK_church_classes_class_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE church_classes DROP COLUMN class_type_id`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_class_types_is_active"`);
    await queryRunner.query(`DROP TABLE class_types`);
  }
}
