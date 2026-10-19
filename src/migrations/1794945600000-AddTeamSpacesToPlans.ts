import { MigrationInterface, QueryRunner } from 'typeorm';

// New module: on every plan that has departments (all of them today), since it's built on the roster. Movable from the Plans page.
export class AddTeamSpacesToPlans1794945600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans
       SET features = array_append(features, 'team_spaces')
       WHERE 'departments' = ANY(features)
         AND NOT ('team_spaces' = ANY(features))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans SET features = array_remove(features, 'team_spaces')`,
    );
  }
}
