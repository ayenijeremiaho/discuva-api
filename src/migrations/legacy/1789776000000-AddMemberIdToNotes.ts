import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMemberIdToNotes1789776000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE notes
      ADD COLUMN member_id UUID NULL REFERENCES members(id) ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_notes_member_id" ON notes (member_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_notes_member_id"`);
    await queryRunner.query(`ALTER TABLE notes DROP COLUMN member_id`);
  }
}
