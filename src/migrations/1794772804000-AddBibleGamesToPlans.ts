import { MigrationInterface, QueryRunner } from 'typeorm';

// Bible Games start on every plan; a platform admin can remove the key from a plan afterwards.
export class AddBibleGamesToPlans1794772804000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans SET features = array_append(features, 'bible_games') WHERE NOT ('bible_games' = ANY(features))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans SET features = array_remove(features, 'bible_games')`,
    );
  }
}
