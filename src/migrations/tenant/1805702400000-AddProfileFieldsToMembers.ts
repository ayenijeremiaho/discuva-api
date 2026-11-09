import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 3: address and emergency contact on the church copy, and class types that count as a milestone.
export class AddProfileFieldsToMembers1805702400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS address character varying(300),
        ADD COLUMN IF NOT EXISTS emergency_contact_name character varying(120),
        ADD COLUMN IF NOT EXISTS emergency_contact_phone character varying(32),
        ADD COLUMN IF NOT EXISTS emergency_contact_relationship character varying(60)`);
    await queryRunner.query(
      `ALTER TABLE class_types ADD COLUMN IF NOT EXISTS counts_as character varying(24)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE class_types DROP COLUMN IF EXISTS counts_as`,
    );
    await queryRunner.query(`
      ALTER TABLE members
        DROP COLUMN IF EXISTS address,
        DROP COLUMN IF EXISTS emergency_contact_name,
        DROP COLUMN IF EXISTS emergency_contact_phone,
        DROP COLUMN IF EXISTS emergency_contact_relationship`);
  }
}
