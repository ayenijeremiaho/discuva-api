import { MigrationInterface, QueryRunner } from 'typeorm';

// The genesis seed gave the default class types ids like 11111111-0000-0000-0000-000000000001,
// which aren't RFC 4122 UUIDs, so @IsUUID / ParseUUIDPipe reject them (e.g. creating a class).
export class ReplaceSeededClassTypeIds1799823600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE class_types ADD COLUMN new_id uuid`);
    await queryRunner.query(`
      UPDATE class_types SET new_id = gen_random_uuid()
      WHERE id::text LIKE '11111111-0000-0000-0000-%'
    `);
    await queryRunner.query(
      `ALTER TABLE church_classes DROP CONSTRAINT "FK_church_classes_class_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE class_types DROP CONSTRAINT class_types_next_class_type_id_fkey`,
    );
    await queryRunner.query(`
      UPDATE church_classes c SET class_type_id = t.new_id
      FROM class_types t
      WHERE c.class_type_id = t.id AND t.new_id IS NOT NULL
    `);
    await queryRunner.query(`
      UPDATE class_types c SET next_class_type_id = t.new_id
      FROM class_types t
      WHERE c.next_class_type_id = t.id AND t.new_id IS NOT NULL
    `);
    await queryRunner.query(
      `UPDATE class_types SET id = new_id WHERE new_id IS NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE class_types DROP COLUMN new_id`);
    await queryRunner.query(`
      ALTER TABLE church_classes ADD CONSTRAINT "FK_church_classes_class_type"
        FOREIGN KEY (class_type_id) REFERENCES class_types(id) ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE class_types ADD CONSTRAINT class_types_next_class_type_id_fkey
        FOREIGN KEY (next_class_type_id) REFERENCES class_types(id) ON DELETE SET NULL
    `);
  }

  // The old ids were invalid; there is nothing worth restoring.
  async down(): Promise<void> {}
}
