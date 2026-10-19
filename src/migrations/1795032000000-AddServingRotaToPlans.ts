import { MigrationInterface, QueryRunner } from 'typeorm';

// New module: on every plan that has departments (all of them today), since it's built on the roster. Movable from the Plans page.
export class AddServingRotaToPlans1795032000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans
       SET features = array_append(features, 'serving_rota')
       WHERE 'departments' = ANY(features)
         AND NOT ('serving_rota' = ANY(features))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans SET features = array_remove(features, 'serving_rota')`,
    );
  }
}
