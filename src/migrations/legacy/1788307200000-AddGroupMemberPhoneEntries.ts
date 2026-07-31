import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a group_members row represent either a real Member (member_id set) or
 * a phone-only entry (phone_number set) — e.g. a manually-typed number, or one
 * imported from a FirstTimer who has no Member account. The CHECK constraint
 * enforces exactly one of the two is set; the service layer never sets both.
 */
export class AddGroupMemberPhoneEntries1788307200000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE group_members ALTER COLUMN member_id DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE group_members ADD COLUMN phone_number character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE group_members ADD COLUMN label character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE group_members ADD CONSTRAINT "UQ_group_members_group_id_phone_number" UNIQUE (group_id, phone_number)`,
    );
    await queryRunner.query(`
      ALTER TABLE group_members ADD CONSTRAINT "CHK_group_members_member_xor_phone"
      CHECK (
        (member_id IS NOT NULL AND phone_number IS NULL) OR
        (member_id IS NULL AND phone_number IS NOT NULL)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE group_members DROP CONSTRAINT IF EXISTS "CHK_group_members_member_xor_phone"`,
    );
    await queryRunner.query(
      `ALTER TABLE group_members DROP CONSTRAINT IF EXISTS "UQ_group_members_group_id_phone_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE group_members DROP COLUMN IF EXISTS label`,
    );
    await queryRunner.query(
      `ALTER TABLE group_members DROP COLUMN IF EXISTS phone_number`,
    );
    await queryRunner.query(
      `ALTER TABLE group_members ALTER COLUMN member_id SET NOT NULL`,
    );
  }
}
