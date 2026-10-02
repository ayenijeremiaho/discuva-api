import { MigrationInterface, QueryRunner } from 'typeorm';

export class SetMemberChurchThemeDefault1800255600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE members
        ALTER COLUMN use_church_theme SET DEFAULT true
    `);
    await queryRunner.query(`
      UPDATE members
      SET use_church_theme = true
      WHERE use_church_theme = false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE members
        ALTER COLUMN use_church_theme SET DEFAULT false
    `);
  }
}
