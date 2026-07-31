import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDocumentUrlToClassesAndSundaySchoolSessions1790294400000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE church_classes
      ADD COLUMN document_url character varying NULL
    `);
    await queryRunner.query(`
      ALTER TABLE sunday_school_sessions
      ADD COLUMN document_url character varying NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE sunday_school_sessions DROP COLUMN document_url`,
    );
    await queryRunner.query(
      `ALTER TABLE church_classes DROP COLUMN document_url`,
    );
  }
}
