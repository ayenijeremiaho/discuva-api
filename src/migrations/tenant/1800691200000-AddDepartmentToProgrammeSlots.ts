import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDepartmentToProgrammeSlots1800691200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE service_programme_slots
        ADD COLUMN IF NOT EXISTS department_id UUID,
        ADD COLUMN IF NOT EXISTS backup_department_id UUID
    `);
    await queryRunner.query(`
      ALTER TABLE service_programme_slots
        ADD CONSTRAINT "FK_service_programme_slots_department_id" FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
        ADD CONSTRAINT "FK_service_programme_slots_backup_department_id" FOREIGN KEY (backup_department_id) REFERENCES departments(id) ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_service_programme_slots_department_id" ON service_programme_slots (department_id) WHERE department_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_service_programme_slots_backup_department_id" ON service_programme_slots (backup_department_id) WHERE backup_department_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_service_programme_slots_backup_department_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_service_programme_slots_department_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE service_programme_slots
        DROP CONSTRAINT IF EXISTS "FK_service_programme_slots_backup_department_id",
        DROP CONSTRAINT IF EXISTS "FK_service_programme_slots_department_id",
        DROP COLUMN IF EXISTS backup_department_id,
        DROP COLUMN IF EXISTS department_id
    `);
  }
}
