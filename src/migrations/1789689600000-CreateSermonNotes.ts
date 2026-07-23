import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSermonNotes1789689600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE sermon_notes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sermon_id UUID NOT NULL REFERENCES sermons(id) ON DELETE CASCADE,
        member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        note TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_sermon_notes_sermon_member" UNIQUE (sermon_id, member_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_sermon_notes_sermon_id" ON sermon_notes (sermon_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE sermon_notes`);
  }
}
