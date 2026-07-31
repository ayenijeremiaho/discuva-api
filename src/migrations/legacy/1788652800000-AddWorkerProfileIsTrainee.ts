import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkerProfileIsTrainee1788652800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE worker_profiles
        ADD COLUMN is_trainee boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_worker_profiles_is_trainee" ON worker_profiles (is_trainee)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_worker_profiles_is_trainee"`,
    );
    await queryRunner.query(
      `ALTER TABLE worker_profiles DROP COLUMN is_trainee`,
    );
  }
}
