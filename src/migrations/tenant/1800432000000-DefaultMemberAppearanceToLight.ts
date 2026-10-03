import { MigrationInterface, QueryRunner } from 'typeorm';

export class DefaultMemberAppearanceToLight1800432000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS appearance_mode VARCHAR NOT NULL DEFAULT 'light'
    `);
    await queryRunner.query(`
      ALTER TABLE members
        ALTER COLUMN appearance_mode SET DEFAULT 'light'
    `);
    await queryRunner.query(`
      UPDATE members
      SET appearance_mode = 'light'
      WHERE appearance_mode = 'system'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE members
        ALTER COLUMN appearance_mode SET DEFAULT 'system'
    `);
  }
}
