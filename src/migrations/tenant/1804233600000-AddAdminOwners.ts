import { MigrationInterface, QueryRunner } from 'typeorm';

// Account Owners: the earliest active SuperAdmin (or failing that, the earliest active admin) becomes the first owner.
export class AddAdminOwners1804233600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE admins
         ADD COLUMN IF NOT EXISTS is_owner boolean NOT NULL DEFAULT false,
         ADD COLUMN IF NOT EXISTS owner_invited_at timestamptz,
         ADD COLUMN IF NOT EXISTS owner_invited_by_id uuid REFERENCES admins(id) ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_admins_is_owner" ON admins (id) WHERE is_owner = true`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_admins_owner_invited" ON admins (id) WHERE owner_invited_at IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_admins_owner_invited_by_id" ON admins (owner_invited_by_id)`,
    );
    await queryRunner.query(
      `UPDATE admins SET is_owner = true
       WHERE id = (
         SELECT a.id FROM admins a
         LEFT JOIN admin_roles r ON r.id = a.admin_role_id
         WHERE a.is_active = true
         ORDER BY (r.name = 'SuperAdmin') DESC NULLS LAST, a.created_at ASC
         LIMIT 1
       )
       AND NOT EXISTS (SELECT 1 FROM admins WHERE is_owner = true)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_admins_owner_invited_by_id"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_admins_owner_invited"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_admins_is_owner"`);
    await queryRunner.query(
      `ALTER TABLE admins
         DROP COLUMN IF EXISTS owner_invited_by_id,
         DROP COLUMN IF EXISTS owner_invited_at,
         DROP COLUMN IF EXISTS is_owner`,
    );
  }
}
