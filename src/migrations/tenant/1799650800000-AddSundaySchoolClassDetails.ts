import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSundaySchoolClassDetails1799650800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE sunday_school_classes
        ADD age_group character varying,
        ADD meeting_day character varying,
        ADD meeting_time character varying,
        ADD location character varying
    `);
    await queryRunner.query(`
      CREATE TABLE sunday_school_class_assistants (
        sunday_school_class_id UUID NOT NULL,
        member_id              UUID NOT NULL,
        CONSTRAINT "PK_sunday_school_class_assistants" PRIMARY KEY (sunday_school_class_id, member_id),
        CONSTRAINT "FK_sunday_school_class_assistants_sunday_school_class_id" FOREIGN KEY (sunday_school_class_id) REFERENCES sunday_school_classes (id) ON DELETE CASCADE,
        CONSTRAINT "FK_sunday_school_class_assistants_member_id" FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_sunday_school_class_assistants_member_id" ON sunday_school_class_assistants (member_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_sunday_school_class_assistants_member_id"`,
    );
    await queryRunner.query(`DROP TABLE sunday_school_class_assistants`);
    await queryRunner.query(`
      ALTER TABLE sunday_school_classes
        DROP COLUMN location,
        DROP COLUMN meeting_time,
        DROP COLUMN meeting_day,
        DROP COLUMN age_group
    `);
  }
}
