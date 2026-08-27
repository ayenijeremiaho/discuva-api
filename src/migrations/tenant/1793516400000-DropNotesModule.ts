import { MigrationInterface, QueryRunner } from 'typeorm';

// Notes module removed — superseded by Forms' new ADMIN_ONLY visibility
// (an admin defines whatever fields a pastoral-record type needs and
// records submissions against it, rather than a fixed set of hardcoded
// note types). The table was never exposed through any frontend.
export class DropNotesModule1793516400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE admin_roles
      SET permissions = array_remove(array_remove(permissions, 'notes:read'), 'notes:write')
      WHERE permissions && ARRAY['notes:read', 'notes:write'];
    `);
    await queryRunner.query(`DROP TABLE notes;`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE notes (
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        type character varying NOT NULL,
        details json NOT NULL,
        member_id UUID,
        CONSTRAINT "PK_notes" PRIMARY KEY (id)
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_notes_member_id" ON notes USING btree (member_id);
    `);
    await queryRunner.query(`
      ALTER TABLE ONLY notes
      ADD CONSTRAINT "FK_notes_member_id" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;
    `);
    // The stripped notes:read/notes:write grants on pre-existing admin_roles
    // are not restorable — which roles held them is not recorded anywhere.
  }
}
