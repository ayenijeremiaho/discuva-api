import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 4: a member who moved to another branch keeps their record here as history.
export class AddMemberTransfer1805961600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE members ADD COLUMN IF NOT EXISTS transferred_at timestamptz NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE members ADD COLUMN IF NOT EXISTS transferred_to_tenant_id uuid NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE members DROP COLUMN IF EXISTS transferred_to_tenant_id`,
    );
    await queryRunner.query(
      `ALTER TABLE members DROP COLUMN IF EXISTS transferred_at`,
    );
  }
}
