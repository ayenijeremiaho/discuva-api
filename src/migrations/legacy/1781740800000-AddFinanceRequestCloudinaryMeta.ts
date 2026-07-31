import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFinanceRequestCloudinaryMeta1781740800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "finance_requests"
                ADD COLUMN "attachment_public_id"    character varying NULL,
                ADD COLUMN "attachment_resource_type" character varying NULL,
                ADD COLUMN "proof_public_id"          character varying NULL,
                ADD COLUMN "proof_resource_type"      character varying NULL
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "finance_requests"
                DROP COLUMN "attachment_public_id",
                DROP COLUMN "attachment_resource_type",
                DROP COLUMN "proof_public_id",
                DROP COLUMN "proof_resource_type"
        `);
  }
}
