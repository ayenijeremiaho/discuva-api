import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampusAdmins1805356800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE campus_admins (
        campus_id uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
        admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (campus_id, admin_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_campus_admins_admin" ON campus_admins (admin_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE campus_admins`);
  }
}
