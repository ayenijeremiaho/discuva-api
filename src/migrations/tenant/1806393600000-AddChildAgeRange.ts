import { MigrationInterface, QueryRunner } from 'typeorm';

// Parents may give an age range instead of a date of birth.
export class AddChildAgeRange1806393600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE child_profiles ALTER COLUMN date_of_birth DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS age_range character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS age_range_set_on date`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE child_profiles DROP COLUMN IF EXISTS age_range_set_on`,
    );
    await queryRunner.query(
      `ALTER TABLE child_profiles DROP COLUMN IF EXISTS age_range`,
    );
  }
}
