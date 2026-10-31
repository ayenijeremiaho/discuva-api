import { MigrationInterface, QueryRunner } from 'typeorm';

// Existing programmes were announced as they were made, so they count as already published.
export class AddProgrammePublishing1805097600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE service_programmes ADD COLUMN published_at timestamptz`,
    );
    await queryRunner.query(
      `UPDATE service_programmes SET published_at = created_at`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE service_programmes DROP COLUMN published_at`,
    );
  }
}
