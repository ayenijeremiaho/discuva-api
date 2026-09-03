import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFormFieldConstraints1795244400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE form_fields
        ADD min_value double precision NULL,
        ADD max_value double precision NULL,
        ADD min_length smallint NULL,
        ADD max_length smallint NULL,
        ADD min_selections smallint NULL,
        ADD max_selections smallint NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE form_fields
        DROP COLUMN min_value,
        DROP COLUMN max_value,
        DROP COLUMN min_length,
        DROP COLUMN max_length,
        DROP COLUMN min_selections,
        DROP COLUMN max_selections
    `);
  }
}
