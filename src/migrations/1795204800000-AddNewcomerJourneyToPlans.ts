import { MigrationInterface, QueryRunner } from 'typeorm';

// New module: offered on every plan (the same plans as Team Pulse, which is all of them). Movable from the Plans page.
export class AddNewcomerJourneyToPlans1795204800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans
       SET features = array_append(features, 'newcomer_journey')
       WHERE ('team_pulse' = ANY(features) OR 'departments' = ANY(features))
         AND NOT ('newcomer_journey' = ANY(features))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans SET features = array_remove(features, 'newcomer_journey')`,
    );
  }
}
