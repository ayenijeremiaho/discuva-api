import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminAccessGrants1805961600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE admins ADD COLUMN additional_permissions text[] NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(`CREATE TABLE form_admin_access (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      can_view boolean NOT NULL DEFAULT true,
      can_export boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CHK_form_admin_access_export_view" CHECK (NOT can_export OR can_view),
      CONSTRAINT "UQ_form_admin_access_form_admin" UNIQUE (form_id, admin_id)
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_form_admin_access_admin_form" ON form_admin_access (admin_id, form_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE form_admin_access');
    await queryRunner.query(
      'ALTER TABLE admins DROP COLUMN additional_permissions',
    );
  }
}
