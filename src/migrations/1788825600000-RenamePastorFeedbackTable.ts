import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenamePastorFeedbackTable1788825600000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE department_feedback RENAME TO pastor_feedback`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE pastor_feedback RENAME TO department_feedback`,
    );
  }
}
