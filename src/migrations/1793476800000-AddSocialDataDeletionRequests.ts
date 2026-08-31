import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSocialDataDeletionRequests1793476800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE social_data_deletion_requests (
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        platform character varying NOT NULL,
        platform_user_id character varying NOT NULL,
        confirmation_code character varying NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_social_data_deletion_requests" PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_social_data_deletion_requests_confirmation_code"
      ON social_data_deletion_requests (confirmation_code)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "UQ_social_data_deletion_requests_confirmation_code"`,
    );
    await queryRunner.query(`DROP TABLE social_data_deletion_requests`);
  }
}
