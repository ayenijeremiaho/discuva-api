import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommunityToPlans1806172800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans
       SET features = array_append(features, 'community')
       WHERE 'team_spaces' = ANY(features)
         AND NOT ('community' = ANY(features))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans SET features = array_remove(features, 'community')`,
    );
  }
}
