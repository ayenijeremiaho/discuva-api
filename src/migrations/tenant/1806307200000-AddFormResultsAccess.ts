import { MigrationInterface, QueryRunner } from 'typeorm';

// Who sees a form's responses: OPEN (role-based, as before) or RESTRICTED to the people chosen on it.
export class AddFormResultsAccess1806307200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE forms ADD COLUMN IF NOT EXISTS results_access character varying NOT NULL DEFAULT 'OPEN'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE forms DROP COLUMN IF EXISTS results_access`,
    );
  }
}
