import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSharedSpaces1804320000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE shared_spaces (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name character varying(100) NOT NULL,
        audience character varying NOT NULL,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE shared_space_sources (
        shared_space_id uuid NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE,
        kind character varying NOT NULL,
        ref_id uuid NOT NULL,
        PRIMARY KEY (shared_space_id, kind, ref_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_shared_space_sources_team" ON shared_space_sources (kind, ref_id)`,
    );
    await queryRunner.query(`
      CREATE TABLE shared_space_people (
        shared_space_id uuid NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE,
        member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        is_leader boolean NOT NULL DEFAULT false,
        PRIMARY KEY (shared_space_id, member_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_shared_space_people_member" ON shared_space_people (member_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE shared_space_people`);
    await queryRunner.query(`DROP TABLE shared_space_sources`);
    await queryRunner.query(`DROP TABLE shared_spaces`);
  }
}
