import { MigrationInterface, QueryRunner } from 'typeorm';

// Notes start on every plan; a platform admin can remove the key from a plan afterwards.
export class AddNotesToPlans1794772803000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans SET features = array_append(features, 'notes') WHERE NOT ('notes' = ANY(features))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans SET features = array_remove(features, 'notes')`,
    );
  }
}
