import { MigrationInterface, QueryRunner } from 'typeorm';

// New module: offered wherever Pastor Feedback already is (the closest leadership tool). Movable from the Plans page.
export class AddTeamPulseToPlans1794859200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans
       SET features = array_append(features, 'team_pulse')
       WHERE 'pastor_feedback' = ANY(features)
         AND NOT ('team_pulse' = ANY(features))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans SET features = array_remove(features, 'team_pulse')`,
    );
  }
}
