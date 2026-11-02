import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDepartmentCampus1805443200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE departments ADD COLUMN campus_id uuid REFERENCES campuses(id) ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_departments_campus_id" ON departments (campus_id) WHERE campus_id IS NOT NULL`,
    );
    // Two campuses can each have their own "Choir"; names stay unique within a campus and church-wide.
    await queryRunner.query(
      `ALTER TABLE departments DROP CONSTRAINT "UQ_departments_name"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_departments_name_campus" ON departments (name, COALESCE(campus_id, '00000000-0000-0000-0000-000000000000'::uuid))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_departments_name_campus"`);
    await queryRunner.query(
      `ALTER TABLE departments ADD CONSTRAINT "UQ_departments_name" UNIQUE (name)`,
    );
    await queryRunner.query(`DROP INDEX "IDX_departments_campus_id"`);
    await queryRunner.query(`ALTER TABLE departments DROP COLUMN campus_id`);
  }
}
