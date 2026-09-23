import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMemberSpouse1798786800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE members ADD spouse_id uuid NULL
    `);
    await queryRunner.query(`
      ALTER TABLE members
      ADD CONSTRAINT "FK_members_spouse_id"
      FOREIGN KEY (spouse_id) REFERENCES members(id) ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_members_spouse_id" ON members USING btree (spouse_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_members_spouse_id"`);
    await queryRunner.query(
      `ALTER TABLE members DROP CONSTRAINT "FK_members_spouse_id"`,
    );
    await queryRunner.query(`ALTER TABLE members DROP COLUMN spouse_id`);
  }
}
