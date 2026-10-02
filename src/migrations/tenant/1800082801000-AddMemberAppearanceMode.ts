import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMemberAppearanceMode1800082801000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS appearance_mode VARCHAR NOT NULL DEFAULT 'system'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE members
        DROP COLUMN IF EXISTS appearance_mode
    `);
  }
}
