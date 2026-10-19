import { MigrationInterface, QueryRunner } from 'typeorm';

// AddTeamSpacesToPlans / AddServingRotaToPlans keyed on 'departments', which only the free plan lists (it's a required
// module, so paid plans never needed it). Offer both wherever Team Pulse is offered, i.e. every plan. Idempotent.
export class AddTeamSpacesAndRotaToAllPlans1795118400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const key of ['team_spaces', 'serving_rota'])
      await queryRunner.query(
        `UPDATE plans
         SET features = array_append(features, $1)
         WHERE ('team_pulse' = ANY(features) OR 'departments' = ANY(features))
           AND NOT ($1 = ANY(features))`,
        [key],
      );
  }

  public async down(): Promise<void> {
    // Nothing to undo separately: the earlier migrations' down() removes both keys from every plan.
  }
}
